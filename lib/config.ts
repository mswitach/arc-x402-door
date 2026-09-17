/**
 * Runtime config for the Arc x402 door.
 * NETWORK=arc-mainnet maps to Circle Facilitator CAIP-2 eip155:5042.
 */

export const ARC_MAINNET_CAIP2 = "eip155:5042" as const;
export const ARC_TESTNET_CAIP2 = "eip155:5042002" as const;

/** USDC ERC-20 on Arc (mainnet + testnet share this precompile address). */
export const ARC_USDC = "0x3600000000000000000000000000000000000000" as const;

/** Confirmed live Facilitator Service x402 base (GET /supported → 200). */
export const DEFAULT_FACILITATOR_URL =
  "https://api.circle.com/v1/facilitator/x402" as const;

export type AppConfig = {
  payTo: `0x${string}`;
  facilitatorUrl: string;
  networkCaip2: typeof ARC_MAINNET_CAIP2 | typeof ARC_TESTNET_CAIP2;
  networkLabel: "arc-mainnet" | "arc-testnet";
  priceUsdc: string;
  /** Atomic USDC amount (6 decimals) as decimal string. */
  amountAtomic: string;
  circleApiKey?: string;
  allowDemoPaid: boolean;
};

function parsePriceToAtomic(priceUsdc: string): string {
  const n = Number(priceUsdc);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid PRICE_USDC: ${priceUsdc}`);
  }
  // USDC has 6 decimals; avoid float drift for common micro amounts.
  const atomic = Math.round(n * 1_000_000);
  return String(atomic);
}

function normalizeNetwork(
  raw: string | undefined,
): Pick<AppConfig, "networkCaip2" | "networkLabel"> {
  const v = (raw ?? "arc-mainnet").trim().toLowerCase();
  if (v === "arc-mainnet" || v === "eip155:5042" || v === "5042") {
    return { networkCaip2: ARC_MAINNET_CAIP2, networkLabel: "arc-mainnet" };
  }
  if (v === "arc-testnet" || v === "eip155:5042002" || v === "5042002") {
    return { networkCaip2: ARC_TESTNET_CAIP2, networkLabel: "arc-testnet" };
  }
  // Default to Arc Mainnet for this microgrant pack.
  return { networkCaip2: ARC_MAINNET_CAIP2, networkLabel: "arc-mainnet" };
}

export function getConfig(): AppConfig {
  const payToRaw = process.env.PAY_TO?.trim();
  const payTo = (payToRaw && /^0x[a-fA-F0-9]{40}$/.test(payToRaw)
    ? payToRaw
    : "0x0000000000000000000000000000000000000001") as `0x${string}`;

  const priceUsdc = process.env.PRICE_USDC?.trim() || "0.01";
  const { networkCaip2, networkLabel } = normalizeNetwork(process.env.NETWORK);

  return {
    payTo,
    facilitatorUrl:
      process.env.FACILITATOR_URL?.trim() || DEFAULT_FACILITATOR_URL,
    networkCaip2,
    networkLabel,
    priceUsdc,
    amountAtomic: parsePriceToAtomic(priceUsdc),
    circleApiKey: process.env.CIRCLE_API_KEY?.trim() || undefined,
    allowDemoPaid: process.env.ALLOW_DEMO_PAID === "true",
  };
}

export function buildPaymentRequirements(cfg: AppConfig) {
  return {
    scheme: "exact" as const,
    network: cfg.networkCaip2,
    maxAmountRequired: cfg.amountAtomic,
    amount: cfg.amountAtomic,
    asset: ARC_USDC,
    payTo: cfg.payTo,
    resource: "/api/paid",
    description:
      "Arc Microgrant door: JSON evidence that x402 settlement ≠ purpose/agent-authority verification",
    mimeType: "application/json",
    maxTimeoutSeconds: 60,
    extra: {
      name: "USDC",
      version: "2",
      assetTransferMethod: "eip3009",
    },
  };
}
