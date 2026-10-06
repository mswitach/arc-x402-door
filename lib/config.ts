/**
 * Runtime config for the Arc x402 door.
 *
 * Every value advertised in PAYMENT-REQUIRED is aligned with Circle Facilitator
 * Service GET /supported (snapshot 2026-10-06, see EVIDENCE.md):
 *   { x402Version: 2, scheme: "exact", network: "eip155:5042",
 *     asset: "0x3600000000000000000000000000000000000000", decimals: 6,
 *     extra: { name: "USDC", version: "2" } }
 */

import { parseUnits } from "viem";

export const ARC_MAINNET_CAIP2 = "eip155:5042" as const;
export const ARC_TESTNET_CAIP2 = "eip155:5042002" as const;
export const ARC_MAINNET_CHAIN_ID = 5042;
export const ARC_TESTNET_CHAIN_ID = 5042002;

/** USDC ERC-20 interface on Arc (6 decimals). Native gas USDC uses 18 decimals, not used here. */
export const ARC_USDC = "0x3600000000000000000000000000000000000000" as const;
export const USDC_DECIMALS = 6;
/** EIP-712 domain of USDC on Arc, as returned by /supported `extra`. */
export const ARC_USDC_EIP712 = { name: "USDC", version: "2" } as const;

export const X402_VERSION = 2 as const;

export const DEFAULT_FACILITATOR_URL =
  "https://api.circle.com/v1/facilitator/x402" as const;

export const PLACEHOLDER_PAY_TO =
  "0x0000000000000000000000000000000000000001" as const;

export const EXPLORERS: Record<string, string> = {
  [ARC_MAINNET_CAIP2]: "https://explorer.arc.io",
  [ARC_TESTNET_CAIP2]: "https://testnet.arcscan.app",
};

export type AppConfig = {
  payTo: `0x${string}`;
  /** false when PAY_TO is missing/invalid and the placeholder is advertised. */
  payToConfigured: boolean;
  facilitatorUrl: string;
  networkCaip2: typeof ARC_MAINNET_CAIP2 | typeof ARC_TESTNET_CAIP2;
  networkLabel: "arc-mainnet" | "arc-testnet";
  chainId: number;
  priceUsdc: string;
  /** Atomic USDC amount (6 decimals) as decimal string. 0.01 → "10000". */
  amountAtomic: string;
  circleApiKey?: string;
  /** Keyless-trial fallback: key controlling PAY_TO, used only to sign Facilitator-Seller-Proof. */
  sellerPrivateKey?: `0x${string}`;
  allowDemoPaid: boolean;
  /** Safety switch: run /verify but never /settle (staging / rehearsal). */
  settleDisabled: boolean;
  explorerUrl: string;
};

/** Decimal-string → atomic units without float drift (viem parseUnits). */
export function parsePriceToAtomic(priceUsdc: string): string {
  if (!/^\d+(\.\d{1,6})?$/.test(priceUsdc)) {
    throw new Error(`Invalid PRICE_USDC (max 6 decimals): ${priceUsdc}`);
  }
  const atomic = parseUnits(priceUsdc, USDC_DECIMALS);
  if (atomic <= 0n) throw new Error(`PRICE_USDC must be > 0: ${priceUsdc}`);
  return atomic.toString();
}

function normalizeNetwork(
  raw: string | undefined,
): Pick<AppConfig, "networkCaip2" | "networkLabel" | "chainId"> {
  const v = (raw ?? "arc-mainnet").trim().toLowerCase();
  if (v === "arc-testnet" || v === "eip155:5042002" || v === "5042002") {
    return {
      networkCaip2: ARC_TESTNET_CAIP2,
      networkLabel: "arc-testnet",
      chainId: ARC_TESTNET_CHAIN_ID,
    };
  }
  // Default (and any arc-mainnet alias): Arc Mainnet for this microgrant pack.
  return {
    networkCaip2: ARC_MAINNET_CAIP2,
    networkLabel: "arc-mainnet",
    chainId: ARC_MAINNET_CHAIN_ID,
  };
}

export function getConfig(): AppConfig {
  const payToRaw = process.env.PAY_TO?.trim();
  const payToConfigured =
    !!payToRaw &&
    /^0x[a-fA-F0-9]{40}$/.test(payToRaw) &&
    payToRaw.toLowerCase() !== PLACEHOLDER_PAY_TO;
  const payTo = (payToConfigured ? payToRaw : PLACEHOLDER_PAY_TO) as `0x${string}`;

  const priceUsdc = process.env.PRICE_USDC?.trim() || "0.01";
  const net = normalizeNetwork(process.env.NETWORK);
  const sellerKey = process.env.SELLER_PRIVATE_KEY?.trim();

  return {
    payTo,
    payToConfigured,
    facilitatorUrl: (
      process.env.FACILITATOR_URL?.trim() || DEFAULT_FACILITATOR_URL
    ).replace(/\/$/, ""),
    ...net,
    priceUsdc,
    amountAtomic: parsePriceToAtomic(priceUsdc),
    circleApiKey: process.env.CIRCLE_API_KEY?.trim() || undefined,
    sellerPrivateKey:
      sellerKey && /^0x[a-fA-F0-9]{64}$/.test(sellerKey)
        ? (sellerKey as `0x${string}`)
        : undefined,
    allowDemoPaid: process.env.ALLOW_DEMO_PAID?.trim().toLowerCase() === "true",
    settleDisabled: process.env.SETTLE_DISABLED?.trim().toLowerCase() === "true",
    explorerUrl: EXPLORERS[net.networkCaip2],
  };
}

/** x402 v2 PaymentRequirements (exactly the fields the v2 spec / Circle OpenAPI define). */
export type PaymentRequirementsV2 = {
  scheme: "exact";
  network: `${string}:${string}`;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: { name: string; version: string; assetTransferMethod: "eip3009" } & Record<string, unknown>;
};

export function buildPaymentRequirements(cfg: AppConfig): PaymentRequirementsV2 {
  return {
    scheme: "exact",
    network: cfg.networkCaip2,
    amount: cfg.amountAtomic,
    asset: ARC_USDC,
    payTo: cfg.payTo,
    maxTimeoutSeconds: 60,
    extra: {
      name: ARC_USDC_EIP712.name,
      version: ARC_USDC_EIP712.version,
      assetTransferMethod: "eip3009",
    },
  };
}

export const RESOURCE_DESCRIPTION =
  "Arc Microgrant door: JSON evidence that x402 settlement ≠ purpose/agent-authority verification";

export function txExplorerLink(cfg: AppConfig, tx: string): string {
  return `${cfg.explorerUrl}/tx/${tx}`;
}
