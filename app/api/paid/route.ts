import { NextRequest, NextResponse } from "next/server";
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import type { PaymentPayload, PaymentRequired } from "@x402/core/types";
import {
  ARC_USDC,
  RESOURCE_DESCRIPTION,
  X402_VERSION,
  buildPaymentRequirements,
  getConfig,
  txExplorerLink,
  type AppConfig,
  type PaymentRequirementsV2,
} from "@/lib/config";
import { buildEvidencePayload } from "@/lib/evidence";
import {
  assertSellerKeyMatchesPayTo,
  isSettlePending,
  resolveFacilitatorAuth,
  settleWithCircle,
  verifyWithCircle,
  type SettleResponse,
  type VerifyResponse,
} from "@/lib/circle-facilitator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPOSE = "PAYMENT-REQUIRED, PAYMENT-RESPONSE";

function paymentRequired(req: NextRequest, cfg: AppConfig, error?: string): PaymentRequired {
  const url = new URL(req.url);
  return {
    x402Version: X402_VERSION,
    error:
      error ?? "Payment required — USDC on Arc via Circle Facilitator Service (EIP-3009 exact)",
    resource: {
      url: `${url.origin}/api/paid`,
      description: RESOURCE_DESCRIPTION,
      mimeType: "application/json",
    },
    accepts: [buildPaymentRequirements(cfg)],
  };
}

function respond402(
  req: NextRequest,
  cfg: AppConfig,
  error?: string,
  extra?: Record<string, unknown>,
): NextResponse {
  const body = paymentRequired(req, cfg, error);
  return NextResponse.json(
    { ...body, ...extra },
    {
      status: 402,
      headers: {
        "PAYMENT-REQUIRED": encodePaymentRequiredHeader(body),
        "Cache-Control": "no-store",
        "Access-Control-Expose-Headers": EXPOSE,
      },
    },
  );
}

function jsonError(status: number, body: Record<string, unknown>): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function getPaymentSignatureHeader(req: NextRequest): string | undefined {
  // Headers are case-insensitive. X-PAYMENT kept for x402 v1-style clients.
  return req.headers.get("payment-signature") || req.headers.get("x-payment") || undefined;
}

function isDemoPaid(req: NextRequest, cfg: AppConfig): boolean {
  if (!cfg.allowDemoPaid) return false; // ALLOW_DEMO_PAID=false → demo header is ignored → 402
  const h = req.headers.get("x-arc-door-demo");
  const q = new URL(req.url).searchParams.get("demo");
  return h === "paid" || q === "paid";
}

/** The buyer's `accepted` terms must be exactly what this door advertises. */
function acceptedMismatch(
  accepted: PaymentPayload["accepted"] | undefined,
  req: PaymentRequirementsV2,
): string | null {
  if (!accepted) return "paymentPayload.accepted missing";
  const eq = (a: unknown, b: unknown) => String(a ?? "").toLowerCase() === String(b).toLowerCase();
  if (!eq(accepted.scheme, req.scheme)) return "scheme";
  if (!eq(accepted.network, req.network)) return "network";
  if (!eq(accepted.asset, req.asset)) return "asset";
  if (!eq(accepted.payTo, req.payTo)) return "payTo";
  if (String(accepted.amount) !== req.amount) return "amount";
  const extra = (accepted.extra ?? {}) as Record<string, unknown>;
  if (extra.name !== req.extra.name || extra.version !== req.extra.version) return "extra (EIP-712 domain)";
  return null;
}

async function handlePaid(req: NextRequest): Promise<NextResponse> {
  const cfg = getConfig();

  if (isDemoPaid(req, cfg)) {
    const payload = buildEvidencePayload({
      networkLabel: cfg.networkLabel,
      networkCaip2: cfg.networkCaip2,
      facilitatorUrl: cfg.facilitatorUrl,
      amountAtomic: cfg.amountAtomic,
      asset: ARC_USDC,
      payTo: cfg.payTo,
      demo: true,
    });
    return NextResponse.json(payload, {
      status: 200,
      headers: { "Cache-Control": "no-store", "X-Arc-Door-Mode": "demo" },
    });
  }

  const sig = getPaymentSignatureHeader(req);
  if (!sig) return respond402(req, cfg);

  let paymentPayload: PaymentPayload;
  try {
    paymentPayload = decodePaymentSignatureHeader(sig);
  } catch {
    return jsonError(400, {
      error: "Invalid PAYMENT-SIGNATURE (expected base64 JSON x402 v2 PaymentPayload)",
    });
  }
  if (paymentPayload.x402Version !== X402_VERSION) {
    return respond402(req, cfg, `Unsupported x402Version ${paymentPayload.x402Version}; this door speaks v2`);
  }

  if (!cfg.payToConfigured) {
    return jsonError(503, {
      error: "Seller not configured: PAY_TO is unset or the placeholder address. Refusing to settle.",
    });
  }

  const auth = resolveFacilitatorAuth(cfg);
  if (!auth) {
    return jsonError(503, {
      error:
        "Facilitator auth not configured: set CIRCLE_API_KEY (Bearer) or SELLER_PRIVATE_KEY (keyless-trial seller proof).",
      docs: "https://developers.circle.com/facilitator-service/keyless-trial",
    });
  }
  try {
    assertSellerKeyMatchesPayTo(auth);
  } catch (e) {
    return jsonError(503, { error: (e as Error).message });
  }

  const requirements = buildPaymentRequirements(cfg);
  const mismatch = acceptedMismatch(paymentPayload.accepted, requirements);
  if (mismatch) {
    return respond402(req, cfg, `Payment terms mismatch: ${mismatch}`);
  }

  // 1) /verify — no payment created, nothing onchain.
  let verified;
  try {
    verified = await verifyWithCircle({
      facilitatorUrl: cfg.facilitatorUrl,
      auth,
      paymentPayload,
      paymentRequirements: requirements,
    });
  } catch (e) {
    return jsonError(502, { error: "Facilitator /verify unreachable", detail: String(e) });
  }
  if (!verified.ok) {
    return jsonError(502, {
      error: "Facilitator /verify rejected the request",
      facilitatorStatus: verified.status,
      facilitatorBody: verified.body,
    });
  }
  const vbody = verified.body as VerifyResponse;
  if (!vbody?.isValid) {
    return respond402(req, cfg, `Payment invalid: ${vbody?.invalidReason ?? "unknown"}`, {
      verify: vbody,
    });
  }

  if (cfg.settleDisabled) {
    return jsonError(503, {
      error: "Verify passed but SETTLE_DISABLED=true — not settling, not fulfilling.",
      verify: vbody,
    });
  }

  // 2) /settle — the money path. Every settlement outcome is HTTP 200.
  let settled;
  try {
    settled = await settleWithCircle({
      facilitatorUrl: cfg.facilitatorUrl,
      auth,
      paymentPayload,
      paymentRequirements: requirements,
    });
  } catch (e) {
    return jsonError(502, { error: "Facilitator /settle unreachable", detail: String(e) });
  }
  if (!settled.ok) {
    return jsonError(502, {
      error: "Facilitator /settle rejected the request",
      facilitatorStatus: settled.status,
      facilitatorBody: settled.body,
    });
  }
  const sbody = settled.body as SettleResponse;

  // Do not fulfill on pending — Circle docs: reconcile via /status.
  if (isSettlePending(sbody)) {
    return jsonError(202, {
      error: "Settlement pending — not fulfilled. Reconcile via facilitator /status.",
      facilitatorBody: sbody,
    });
  }

  const tx = typeof sbody?.transaction === "string" && sbody.transaction ? sbody.transaction : null;
  if (!sbody?.success || !tx) {
    return respond402(req, cfg, `Settlement failed: ${sbody?.errorReason ?? "unknown"}`, {
      facilitatorBody: sbody,
    });
  }

  const payer = sbody.payer ?? vbody.payer ?? null;
  const evidence = buildEvidencePayload({
    networkLabel: cfg.networkLabel,
    networkCaip2: cfg.networkCaip2,
    facilitatorUrl: cfg.facilitatorUrl,
    amountAtomic: sbody.amount ?? cfg.amountAtomic,
    asset: ARC_USDC,
    payTo: cfg.payTo,
    transactionHash: tx,
    explorerLink: txExplorerLink(cfg, tx),
    payer,
    facilitatorAuth: auth.mode,
    verify: { isValid: true, payer: vbody.payer ?? null },
    demo: false,
  });

  return NextResponse.json(evidence, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "X-Arc-Door-Mode": "settled",
      "PAYMENT-RESPONSE": encodePaymentResponseHeader({
        success: true,
        transaction: tx,
        network: cfg.networkCaip2,
        payer: payer ?? undefined,
      }),
      "Access-Control-Expose-Headers": EXPOSE,
    },
  });
}

export async function GET(req: NextRequest) {
  return handlePaid(req);
}

export async function POST(req: NextRequest) {
  return handlePaid(req);
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, PAYMENT-SIGNATURE, X-PAYMENT, X-Arc-Door-Demo",
      "Access-Control-Expose-Headers": EXPOSE,
    },
  });
}
