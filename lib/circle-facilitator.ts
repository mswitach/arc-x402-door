/**
 * Circle hosted Facilitator Service client.
 *
 * Docs: https://developers.circle.com/facilitator-service
 * Quickstart: https://developers.circle.com/facilitator-service/quickstart
 * Live base: https://api.circle.com/v1/facilitator/x402
 *   GET  /supported  (public)
 *   POST /verify     (auth required)
 *   POST /settle     (auth required)
 *   GET  /status/:id (auth required; pending settlements)
 *
 * Auth:
 *   - Production: Authorization: Bearer <CIRCLE_API_KEY>
 *   - Keyless trial: Facilitator-Seller-Proof: <base64url EIP-712 envelope>
 *     (see Circle quickstart "Build the seller proof" — TODO helper below)
 */

import { HTTPFacilitatorClient } from "@x402/core/server";
import type { AppConfig } from "./config";

export function createCircleFacilitatorClient(cfg: AppConfig): HTTPFacilitatorClient {
  return new HTTPFacilitatorClient({
    url: cfg.facilitatorUrl,
    createAuthHeaders: async () => {
      const headers: Record<string, string> = {};
      if (cfg.circleApiKey) {
        headers.Authorization = `Bearer ${cfg.circleApiKey}`;
      }
      // TODO (keyless trial): when CIRCLE_API_KEY is absent, build Facilitator-Seller-Proof
      // via EIP-712 "Circle Facilitator Seller Request" signed by the key controlling PAY_TO.
      // See https://developers.circle.com/facilitator-service/quickstart — Step 2.
      // headers["Facilitator-Seller-Proof"] = await buildSellerProof({ purpose, method, body });
      return {
        verify: headers,
        settle: headers,
        supported: {},
      };
    },
  });
}

/**
 * Direct settle helper (bypasses @x402/next) for frameworks that only need
 * POST /settle after parsing PAYMENT-SIGNATURE themselves.
 */
export async function settleWithCircle(args: {
  facilitatorUrl: string;
  circleApiKey?: string;
  sellerProof?: string;
  paymentPayload: unknown;
  paymentRequirements: unknown;
}): Promise<{ ok: boolean; status: number; body: unknown }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (args.circleApiKey) {
    headers.Authorization = `Bearer ${args.circleApiKey}`;
  }
  if (args.sellerProof) {
    headers["Facilitator-Seller-Proof"] = args.sellerProof;
  }

  const res = await fetch(`${args.facilitatorUrl.replace(/\/$/, "")}/settle`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      x402Version: 2,
      paymentPayload: args.paymentPayload,
      paymentRequirements: args.paymentRequirements,
    }),
  });

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = { error: "non-json response from facilitator" };
  }
  return { ok: res.ok, status: res.status, body };
}

/**
 * TODO: implement buildSellerProof for keyless trial.
 * Domain: { name: "Circle Facilitator Seller Request", version: "1", chainId }
 * Types: SellerRequest { purpose, method, bodyHash, network, payTo, nonce, issuedAt, expiresAt }
 * Header: Facilitator-Seller-Proof = base64url(JSON envelope)
 */
export async function buildSellerProof(_args: {
  purpose: "verify" | "settle" | "status";
  method: string;
  body: string;
  network: string;
  payTo: `0x${string}`;
  chainId: number;
  sellerPrivateKey: `0x${string}`;
}): Promise<string> {
  throw new Error(
    "TODO: wire seller-proof signing from Circle Facilitator Service quickstart Step 2 (viem signTypedData).",
  );
}
