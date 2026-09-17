import { NextRequest, NextResponse } from "next/server";
import {
  ARC_USDC,
  buildPaymentRequirements,
  getConfig,
} from "@/lib/config";
import { buildEvidencePayload } from "@/lib/evidence";
import { settleWithCircle } from "@/lib/circle-facilitator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function paymentRequiredBody(req: NextRequest) {
  const cfg = getConfig();
  const requirements = buildPaymentRequirements(cfg);
  const url = new URL(req.url);
  return {
    x402Version: 2,
    error: "Payment required — USDC on Arc via Circle Facilitator Service (EIP-3009 exact)",
    accepts: [requirements],
    resource: {
      url: `${url.origin}/api/paid`,
      description: requirements.description,
      mimeType: "application/json",
    },
  };
}

function encodePaymentRequiredHeader(body: unknown): string {
  return Buffer.from(JSON.stringify(body), "utf8").toString("base64");
}

function getPaymentSignatureHeader(req: NextRequest): string | undefined {
  return (
    req.headers.get("payment-signature") ||
    req.headers.get("PAYMENT-SIGNATURE") ||
    req.headers.get("x-payment") ||
    req.headers.get("X-PAYMENT") ||
    undefined
  );
}

function decodePaymentPayload(header: string): unknown {
  // Prefer base64 JSON (x402 v2). Fall back to raw JSON string.
  try {
    const json = Buffer.from(header, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return JSON.parse(header);
  }
}

function unpaid402(req: NextRequest): NextResponse {
  const body = paymentRequiredBody(req);
  return NextResponse.json(body, {
    status: 402,
    headers: {
      "PAYMENT-REQUIRED": encodePaymentRequiredHeader(body),
      "Cache-Control": "no-store",
      "Access-Control-Expose-Headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE",
    },
  });
}

function isDemoPaid(req: NextRequest): boolean {
  const cfg = getConfig();
  if (!cfg.allowDemoPaid) return false;
  const h = req.headers.get("x-arc-door-demo");
  const q = new URL(req.url).searchParams.get("demo");
  return h === "paid" || q === "paid";
}

async function handlePaid(req: NextRequest): Promise<NextResponse> {
  const cfg = getConfig();

  if (isDemoPaid(req)) {
    const payload = buildEvidencePayload({
      networkLabel: cfg.networkLabel,
      networkCaip2: cfg.networkCaip2,
      facilitatorUrl: cfg.facilitatorUrl,
      amountAtomic: cfg.amountAtomic,
      asset: ARC_USDC,
      payTo: cfg.payTo,
      transactionHash: null,
      payer: null,
      demo: true,
    });
    return NextResponse.json(payload, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const sig = getPaymentSignatureHeader(req);
  if (!sig) {
    return unpaid402(req);
  }

  if (!cfg.circleApiKey) {
    return NextResponse.json(
      {
        error:
          "PAYMENT-SIGNATURE present but CIRCLE_API_KEY is not set. Facilitator Service requires Authorization: Bearer <key> (or Facilitator-Seller-Proof for keyless trial).",
        nextSteps: [
          "Copy .env.example → .env.local and set CIRCLE_API_KEY from Circle Console",
          "Or implement buildSellerProof() in lib/circle-facilitator.ts (quickstart Step 2)",
          "FACILITATOR_URL=" + cfg.facilitatorUrl,
          "Docs: https://developers.circle.com/facilitator-service/quickstart",
        ],
        accepts: paymentRequiredBody(req).accepts,
      },
      { status: 401 },
    );
  }

  let paymentPayload: unknown;
  try {
    paymentPayload = decodePaymentPayload(sig);
  } catch {
    return NextResponse.json(
      { error: "Invalid PAYMENT-SIGNATURE (expected base64 JSON payment payload)" },
      { status: 400 },
    );
  }

  const requirements = buildPaymentRequirements(cfg);
  const settled = await settleWithCircle({
    facilitatorUrl: cfg.facilitatorUrl,
    circleApiKey: cfg.circleApiKey,
    paymentPayload,
    paymentRequirements: {
      scheme: requirements.scheme,
      network: requirements.network,
      amount: requirements.amount,
      asset: requirements.asset,
      payTo: requirements.payTo,
      maxTimeoutSeconds: requirements.maxTimeoutSeconds,
      extra: requirements.extra,
    },
  });

  const body = settled.body as Record<string, unknown> | null;
  const success = Boolean(body && (body as { success?: boolean }).success);
  const pending =
    body &&
    typeof body === "object" &&
    (body as { extensions?: { "settlement-status"?: { status?: string } } })
      .extensions?.["settlement-status"]?.status === "pending";

  if (!settled.ok || (!success && !pending)) {
    return NextResponse.json(
      {
        error: "Facilitator settle failed",
        facilitatorStatus: settled.status,
        facilitatorBody: body,
      },
      { status: 402 },
    );
  }

  // Do not fulfill on pending — Circle docs: poll /status until completed.
  if (pending) {
    return NextResponse.json(
      {
        error: "Settlement pending — do not fulfill yet; poll facilitator /status",
        facilitatorBody: body,
      },
      { status: 202 },
    );
  }

  const tx =
    typeof body?.transaction === "string" && body.transaction.length > 0
      ? body.transaction
      : null;
  const payer = typeof body?.payer === "string" ? body.payer : null;

  const evidence = buildEvidencePayload({
    networkLabel: cfg.networkLabel,
    networkCaip2: cfg.networkCaip2,
    facilitatorUrl: cfg.facilitatorUrl,
    amountAtomic: cfg.amountAtomic,
    asset: ARC_USDC,
    payTo: cfg.payTo,
    transactionHash: tx,
    payer,
    demo: false,
  });

  const paymentResponse = Buffer.from(
    JSON.stringify({
      success: true,
      transaction: tx,
      network: cfg.networkCaip2,
      payer,
    }),
    "utf8",
  ).toString("base64");

  return NextResponse.json(evidence, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "PAYMENT-RESPONSE": paymentResponse,
      "Access-Control-Expose-Headers": "PAYMENT-RESPONSE",
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
        "Content-Type, PAYMENT-SIGNATURE, X-PAYMENT, X-Arc-Door-Demo, Authorization",
      "Access-Control-Expose-Headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE",
    },
  });
}
