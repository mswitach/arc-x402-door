/**
 * Shared helpers for the smoke scripts.
 *
 * Keys are read at runtime from BUYER_PRIVATE_KEY / SELLER_PRIVATE_KEY, or from the
 * wallets JSON at ARC_WALLETS_FILE (`_private.buyerKey` / `_private.sellerKey`).
 * Keys are never printed, logged, or written anywhere by these scripts.
 */

import { readFileSync } from "node:fs";
import {
  createPublicClient,
  defineChain,
  formatUnits,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

export const ARC_RPC = process.env.ARC_RPC_URL?.trim() || "https://rpc.mainnet.arc.io";
export const ARC_MAINNET_CHAIN_ID = 5042;
export const ARC_MAINNET_CAIP2 = "eip155:5042";
export const ARC_USDC: Address = "0x3600000000000000000000000000000000000000";
export const ARC_EXPLORER = "https://explorer.arc.io";
export const DEFAULT_DOOR_URL = "https://arc-x402-door.mswitach.workers.dev/api/paid";
export const DEFAULT_WALLETS_FILE =
  "/home/box/agent-data/agents/383d9642-9c20-4fba-b5d1-93d443c6184b/secrets/arc-x402-door-wallets.json";

export const arcMainnet = defineChain({
  id: ARC_MAINNET_CHAIN_ID,
  name: "Arc Mainnet",
  // Native gas token is USDC with 18 decimals; the ERC-20 interface at 0x3600… uses 6.
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC] } },
  blockExplorers: { default: { name: "Arc Explorer", url: ARC_EXPLORER } },
});

export const publicClient = createPublicClient({ chain: arcMainnet, transport: http(ARC_RPC) });

export const erc20BalanceAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export function parseFlags(argv = process.argv.slice(2)) {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const [k, v] = a.slice(2).split("=", 2);
    if (v !== undefined) flags[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) flags[k] = argv[++i];
    else flags[k] = true;
  }
  return flags;
}

function readWalletsFile(): { _private?: { buyerKey?: string; sellerKey?: string } } {
  const path = process.env.ARC_WALLETS_FILE?.trim() || DEFAULT_WALLETS_FILE;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`Cannot read wallets file (set ARC_WALLETS_FILE or BUYER_PRIVATE_KEY/SELLER_PRIVATE_KEY)`);
  }
}

function loadKey(role: "buyer" | "seller"): Hex {
  const envName = role === "buyer" ? "BUYER_PRIVATE_KEY" : "SELLER_PRIVATE_KEY";
  const fromEnv = process.env[envName]?.trim();
  const raw = fromEnv || readWalletsFile()._private?.[role === "buyer" ? "buyerKey" : "sellerKey"];
  if (!raw || !/^0x[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(`${role} key missing or malformed (value not shown)`);
  }
  return raw as Hex;
}

/** Returns an account; the key itself stays inside this closure / viem account. */
export function loadAccount(role: "buyer" | "seller"): PrivateKeyAccount {
  return privateKeyToAccount(loadKey(role));
}

/** Raw key accessor for the seller-proof helper only. Never print the return value. */
export function loadSellerKeyForProof(): Hex {
  return loadKey("seller");
}

export async function balances(addr: Address) {
  const [usdc, native] = await Promise.all([
    publicClient.readContract({
      address: ARC_USDC,
      abi: erc20BalanceAbi,
      functionName: "balanceOf",
      args: [addr],
    }),
    publicClient.getBalance({ address: addr }),
  ]);
  return {
    usdcAtomic: usdc,
    usdc: formatUnits(usdc, 6),
    nativeWei: native,
    native: formatUnits(native, 18),
  };
}

export function short(hex: string, keep = 10): string {
  return hex.length > keep * 2 ? `${hex.slice(0, keep)}…${hex.slice(-6)}` : hex;
}

export function artNow(): string {
  return (
    new Date().toLocaleString("sv-SE", { timeZone: "America/Buenos_Aires" }).replace(" ", "T") +
    "-03:00"
  );
}

export function bigintReplacer(_k: string, v: unknown) {
  return typeof v === "bigint" ? v.toString() : v;
}
