/**
 * Circle hosted Facilitator Service client (x402 v2, exact / EIP-3009).
 *
 * Docs:      https://developers.circle.com/facilitator-service
 * OpenAPI:   https://developers.circle.com/openapi/facilitator-service.yaml
 * Base:      https://api.circle.com/v1/facilitator/x402
 *   GET  /supported        public
 *   POST /verify           auth; no payment created, no trial usage, nothing onchain
 *   POST /settle           auth; the money path (HTTP 200 for every settlement outcome)
 *   GET  /status/:id       auth; reconcile settlement_pending
 *
 * Auth (exactly one; mixing both returns 400):
 *   - Production:    Authorization: Bearer <CIRCLE_API_KEY>
 *   - Keyless trial: Facilitator-Seller-Proof: base64url(EIP-712 envelope signed by the PAY_TO key)
 *     https://developers.circle.com/facilitator-service/sign-seller-proof
 */

import { keccak256, toBytes, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { AppConfig, PaymentRequirementsV2 } from "./config";

export type FacilitatorAuth =
  | { mode: "api-key"; apiKey: string }
  | {
      mode: "seller-proof";
      sellerPrivateKey: `0x${string}`;
      network: string;
      chainId: number;
      payTo: `0x${string}`;
    };

export type VerifyResponse = {
  isValid: boolean;
  invalidReason?: string;
  invalidMessage?: string;
  payer?: string;
};

export type SettleResponse = {
  success: boolean;
  payer?: string;
  transaction?: string;
  network?: string;
  amount?: string;
  errorReason?: string;
  extensions?: {
    "settlement-status"?: { status?: string; paymentId?: string; statusUrl?: string };
  };
};

export type FacilitatorResult<T> = {
  ok: boolean;
  status: number;
  body: T | { code?: number; message?: string; errors?: unknown } | null;
};

/** Pick auth from config. API key wins; seller proof is the keyless-trial fallback. */
export function resolveFacilitatorAuth(cfg: AppConfig): FacilitatorAuth | null {
  if (cfg.circleApiKey) return { mode: "api-key", apiKey: cfg.circleApiKey };
  if (cfg.sellerPrivateKey) {
    return {
      mode: "seller-proof",
      sellerPrivateKey: cfg.sellerPrivateKey,
      network: cfg.networkCaip2,
      chainId: cfg.chainId,
      payTo: cfg.payTo,
    };
  }
  return null;
}

/** Throws if SELLER_PRIVATE_KEY does not control PAY_TO (proof would 401 anyway). */
export function assertSellerKeyMatchesPayTo(auth: FacilitatorAuth): void {
  if (auth.mode !== "seller-proof") return;
  const addr = privateKeyToAccount(auth.sellerPrivateKey).address;
  if (addr.toLowerCase() !== auth.payTo.toLowerCase()) {
    throw new Error("SELLER_PRIVATE_KEY does not control PAY_TO");
  }
}

/**
 * Facilitator-Seller-Proof per Circle "Sign a seller proof".
 * bodyHash = keccak256(raw HTTP body bytes) — the exact string that is sent.
 */
export async function buildSellerProof(args: {
  purpose: "verify" | "settle" | "status";
  method: string;
  body: string;
  network: string;
  chainId: number;
  payTo: `0x${string}`;
  sellerPrivateKey: `0x${string}`;
}): Promise<string> {
  const account = privateKeyToAccount(args.sellerPrivateKey);
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + 300;

  const signature = await account.signTypedData({
    domain: {
      name: "Circle Facilitator Seller Request",
      version: "1",
      chainId: args.chainId,
    },
    types: {
      SellerRequest: [
        { name: "purpose", type: "string" },
        { name: "method", type: "string" },
        { name: "bodyHash", type: "bytes32" },
        { name: "network", type: "string" },
        { name: "payTo", type: "address" },
        { name: "nonce", type: "bytes32" },
        { name: "issuedAt", type: "uint64" },
        { name: "expiresAt", type: "uint64" },
      ],
    },
    primaryType: "SellerRequest",
    message: {
      purpose: args.purpose,
      method: args.method.toUpperCase(),
      bodyHash: keccak256(toBytes(args.body)),
      network: args.network,
      payTo: args.payTo,
      nonce,
      issuedAt: BigInt(issuedAt),
      expiresAt: BigInt(expiresAt),
    },
  });

  const envelope = {
    version: 1,
    signature,
    network: args.network,
    payTo: args.payTo,
    nonce,
    issuedAt,
    expiresAt,
  };
  return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
}

async function authHeaders(
  auth: FacilitatorAuth,
  purpose: "verify" | "settle" | "status",
  method: string,
  body: string,
): Promise<Record<string, string>> {
  if (auth.mode === "api-key") return { Authorization: `Bearer ${auth.apiKey}` };
  return {
    "Facilitator-Seller-Proof": await buildSellerProof({
      purpose,
      method,
      body,
      network: auth.network,
      chainId: auth.chainId,
      payTo: auth.payTo,
      sellerPrivateKey: auth.sellerPrivateKey,
    }),
  };
}

async function postJson<T>(
  facilitatorUrl: string,
  route: "verify" | "settle",
  auth: FacilitatorAuth,
  payload: unknown,
): Promise<FacilitatorResult<T>> {
  const body = JSON.stringify(payload);
  const res = await fetch(`${facilitatorUrl}/${route}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders(auth, route, "POST", body)),
    },
    body,
  });
  let parsed: FacilitatorResult<T>["body"] = null;
  try {
    parsed = (await res.json()) as FacilitatorResult<T>["body"];
  } catch {
    parsed = { message: "non-json response from facilitator" };
  }
  return { ok: res.ok, status: res.status, body: parsed };
}

export function verifyWithCircle(args: {
  facilitatorUrl: string;
  auth: FacilitatorAuth;
  paymentPayload: unknown;
  paymentRequirements: PaymentRequirementsV2;
}): Promise<FacilitatorResult<VerifyResponse>> {
  return postJson<VerifyResponse>(args.facilitatorUrl, "verify", args.auth, {
    x402Version: 2,
    paymentPayload: args.paymentPayload,
    paymentRequirements: args.paymentRequirements,
  });
}

export function settleWithCircle(args: {
  facilitatorUrl: string;
  auth: FacilitatorAuth;
  paymentPayload: unknown;
  paymentRequirements: PaymentRequirementsV2;
}): Promise<FacilitatorResult<SettleResponse>> {
  return postJson<SettleResponse>(args.facilitatorUrl, "settle", args.auth, {
    x402Version: 2,
    paymentPayload: args.paymentPayload,
    paymentRequirements: args.paymentRequirements,
  });
}

export function isSettlePending(body: SettleResponse | null | undefined): boolean {
  if (!body) return false;
  return (
    body.errorReason === "settlement_pending" ||
    body.extensions?.["settlement-status"]?.status === "pending"
  );
}
