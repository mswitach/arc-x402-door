/**
 * Paid response payload — the microgrant claim + citations.
 * Settlement proves USDC moved; it does NOT prove purpose or agent authority.
 */

export type EvidenceItem = {
  fuente: string;
  fecha: string;
  quote: string;
};

export type SettlementEvidence = {
  network: string;
  networkCaip2: string;
  scheme: string;
  facilitator: string;
  facilitatorUrl: string;
  /** Real tx hash returned by Facilitator /settle (null in demo mode). */
  transactionHash: string | null;
  /** Arc explorer link for transactionHash (null in demo mode). */
  explorerLink: string | null;
  payer: string | null;
  /** Auth mode used against the facilitator ("api-key" | "seller-proof" | null in demo). */
  facilitatorAuth: string | null;
  /** /verify result before settle (isValid + payer). */
  verify: { isValid: boolean; payer: string | null } | null;
  amountAtomic: string;
  asset: string;
  payTo: string;
  settledAt: string | null;
  note: string;
};

export type PaidEvidenceResponse = {
  claim: string;
  evidence: EvidenceItem[];
  settlement: SettlementEvidence;
  meta: {
    endpoint: string;
    x402Version: number;
    generatedAt: string;
    demo: boolean;
  };
};

const CIRCLE_DISCLAIMER_QUOTE =
  "Facilitator Service verifies buyer-signed EIP-3009 USDC payment authorizations under the x402 protocol only — it does not hold, control, or transmit user funds, verify transaction purpose, or confirm agent authority scope. On Base and Polygon, settlements are subject to blockchain reorganization risk; Circle does not guarantee fund receipt. Arc settlements are final.";

const SIGNAL_QUOTE =
  "Circle just made Arc a real x402 rail, not a future roadmap item. Arc mainnet is live, and Circle’s hosted x402 facilitator now settles USDC across Arc, Base and Polygon. One detail matters: Circle says the facilitator doesn’t verify transaction purpose or agent authority scope. So settlement is getting easier. The independent “should this buyer sign this exact deal?” check is still a separate job.";

export function buildEvidencePayload(args: {
  networkLabel: string;
  networkCaip2: string;
  facilitatorUrl: string;
  amountAtomic: string;
  asset: string;
  payTo: string;
  transactionHash?: string | null;
  explorerLink?: string | null;
  payer?: string | null;
  facilitatorAuth?: string | null;
  verify?: { isValid: boolean; payer: string | null } | null;
  demo?: boolean;
}): PaidEvidenceResponse {
  const now = new Date();
  // ART = America/Buenos_Aires (UTC-3); tweet created_at is 2026-09-17T11:19:53Z → 08:19:53 ART
  return {
    claim:
      "settle ≠ consent / purpose / agent authority — Circle Facilitator Service settles EIP-3009 USDC authorizations; it does not verify transaction purpose or confirm agent authority scope.",
    evidence: [
      {
        fuente: "https://developers.circle.com/facilitator-service",
        fecha: "2026-09-17",
        quote: CIRCLE_DISCLAIMER_QUOTE,
      },
      {
        fuente: "https://x.com/402Signal/status/2100545270157025304",
        fecha: "2026-09-17 (created_at 2026-09-17T11:19:53Z / 08:19:53 ART)",
        quote: SIGNAL_QUOTE,
      },
    ],
    settlement: {
      network: args.networkLabel === "arc-mainnet" ? "Arc Mainnet" : "Arc Testnet",
      networkCaip2: args.networkCaip2,
      scheme: "exact / EIP-3009",
      facilitator: "Circle hosted Facilitator Service",
      facilitatorUrl: args.facilitatorUrl,
      transactionHash: args.transactionHash ?? null,
      explorerLink: args.explorerLink ?? null,
      payer: args.payer ?? null,
      facilitatorAuth: args.facilitatorAuth ?? null,
      verify: args.verify ?? null,
      amountAtomic: args.amountAtomic,
      asset: args.asset,
      payTo: args.payTo,
      settledAt: args.demo ? null : args.transactionHash ? now.toISOString() : null,
      note: args.demo
        ? "DEMO ONLY (ALLOW_DEMO_PAID=true): paid JSON shape without any on-chain settle. Not evidence of payment."
        : args.transactionHash
          ? "USDC moved on Arc: Circle Facilitator Service verified the buyer's EIP-3009 signature and settled it. Nothing in this flow checked why the buyer paid or whether the signing agent was authorized to. Settlement ≠ consent."
          : "No transaction hash returned by the facilitator.",
    },
    meta: {
      endpoint: "/api/paid",
      x402Version: 2,
      generatedAt: now.toISOString(),
      demo: Boolean(args.demo),
    },
  };
}
