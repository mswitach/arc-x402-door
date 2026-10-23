/**
 * Payment receipt v2: tx hash + block locator + network.
 *
 * Field names follow the x402 receipt payload (x402-foundation/x402#3827: `version`, `network` as CAIP-2,
 * `resourceUrl`, `payer`, `issuedAt`, `transaction`) and the `read_at` locator of
 * `x402-receipt-private-opening/1` (babyblueviper1/preaction-governance-conformance):
 *
 *   read_at = { number: <int, decimal>, hash: "0x" + 64 lower-case hex }
 *
 * Here `read_at` is the block the settlement transaction was included in. The receipt already
 * names that transaction, so pointing at its block leaks nothing new. A verifier fetches exactly
 * that block (eth_getBlockByNumber), so it never needs an eth_getLogs range (Arc's public RPC caps
 * getLogs at 10k blocks). If the canonical hash at that height differs, the receipt is `reorged`;
 * if the block is canonical but does not hold the payment, it is `wrong`.
 *
 * Unsigned: this is a self-describing record, not the EIP-712/JWS-signed receipt of the spec.
 * Dependency-free (plain fetch JSON-RPC) so it runs in the Worker and in Node scripts.
 */

export const RECEIPT_VERSION = 2 as const;

/** keccak256("Transfer(address,address,uint256)") */
export const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
/** keccak256("AuthorizationUsed(address,bytes32)") (EIP-3009) */
export const AUTHORIZATION_USED_TOPIC =
  "0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5";

export const DEFAULT_RPC: Record<string, string> = {
  "eip155:5042": "https://rpc.mainnet.arc.io",
  "eip155:5042002": "https://rpc.testnet.arc.network",
};

export type ReadAt = { number: number; hash: string };

export type PaymentReceiptV2 = {
  version: 2;
  /** CAIP-2, e.g. "eip155:5042" (Arc Mainnet). */
  network: string;
  /** EVM chain id, the numeric reference of `network` (5042 for Arc Mainnet). */
  chainId: number;
  resourceUrl: string;
  /** Lower-case 0x address. */
  payer: string;
  payTo: string;
  asset: string;
  /** Atomic units, decimal string (USDC: 6 decimals; "10000" = 0.01 USDC). */
  amount: string;
  /** Unix seconds. */
  issuedAt: number;
  /** Settlement tx hash, lower-case 0x + 64 hex. */
  transaction: string;
  /**
   * x402#3827 receipt-payload-v2 fields. Empty strings = "no commitment" (the spec's rule: set both or neither);
   * this receipt names the transaction openly instead.
   */
  authorizationMethod: "";
  authorizationCommitment: "";
  /** Block the settlement was included in. */
  read_at: ReadAt;
};

const HEX32 = /^0x[0-9a-f]{64}$/;
const ADDR = /^0x[0-9a-f]{40}$/;

/** Same rule as `_read_at_ok` in x402-receipt-private-opening/1 (statement.py). */
export function readAtOk(r: unknown): r is ReadAt {
  if (!r || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  return (
    keys.length === 2 &&
    keys[0] === "hash" &&
    keys[1] === "number" &&
    Number.isSafeInteger(o.number) &&
    (o.number as number) >= 0 &&
    typeof o.hash === "string" &&
    HEX32.test(o.hash)
  );
}

/** Returns the list of problems; empty means well-formed. */
export function receiptProblems(r: unknown): string[] {
  const p: string[] = [];
  if (!r || typeof r !== "object") return ["not an object"];
  const o = r as Record<string, unknown>;
  if (o.version !== 2) p.push("version must be 2");
  const m = typeof o.network === "string" ? /^eip155:(\d+)$/.exec(o.network) : null;
  if (!m) p.push('network must be CAIP-2 "eip155:<chainId>"');
  if (!Number.isSafeInteger(o.chainId)) p.push("chainId must be an integer");
  else if (m && Number(m[1]) !== o.chainId) p.push("chainId does not match network");
  if (typeof o.transaction !== "string" || !HEX32.test(o.transaction)) p.push("transaction must be 0x + 64 lower-case hex");
  for (const k of ["payer", "payTo", "asset"] as const) {
    if (typeof o[k] !== "string" || !ADDR.test(o[k] as string)) p.push(`${k} must be a lower-case 0x address`);
  }
  if (typeof o.amount !== "string" || !/^\d+$/.test(o.amount)) p.push("amount must be a decimal string");
  if (!Number.isSafeInteger(o.issuedAt)) p.push("issuedAt must be unix seconds (integer)");
  if (typeof o.resourceUrl !== "string") p.push("resourceUrl must be a string");
  if (o.authorizationMethod !== "" || o.authorizationCommitment !== "") {
    p.push('authorizationMethod / authorizationCommitment must both be "" (no commitment in this receipt)');
  }
  if (!readAtOk(o.read_at)) p.push("read_at must be {number: int, hash: 0x + 64 lower-case hex}");
  return p;
}

export async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const j = (await res.json()) as { result?: T; error?: { message?: string } };
  if (j.error) throw new Error(`${method}: ${j.error.message ?? "rpc error"}`);
  return j.result as T;
}

export type RpcLog = { address: string; topics: string[]; data: string; logIndex: string };
export type RpcTxReceipt = {
  status: string;
  blockNumber: string;
  blockHash: string;
  transactionHash: string;
  logs: RpcLog[];
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** eth_getTransactionReceipt, retried briefly while the node has not indexed it yet. */
export async function fetchTxReceipt(
  rpcUrl: string,
  tx: string,
  { attempts = 6, delayMs = 500 } = {},
): Promise<RpcTxReceipt | null> {
  for (let i = 0; i < attempts; i++) {
    const r = await rpc<RpcTxReceipt | null>(rpcUrl, "eth_getTransactionReceipt", [tx]);
    if (r) return r;
    if (i < attempts - 1) await sleep(delayMs);
  }
  return null;
}

export async function buildReceiptV2(args: {
  rpcUrl?: string;
  network: string;
  chainId: number;
  resourceUrl: string;
  payer: string;
  payTo: string;
  asset: string;
  amount: string;
  transaction: string;
  issuedAt?: number;
}): Promise<PaymentReceiptV2> {
  const rpcUrl = args.rpcUrl ?? DEFAULT_RPC[args.network];
  if (!rpcUrl) throw new Error(`no RPC for ${args.network}`);
  const tx = args.transaction.toLowerCase();
  const r = await fetchTxReceipt(rpcUrl, tx);
  if (!r) throw new Error(`no receipt yet for ${tx}`);
  if (r.status !== "0x1") throw new Error(`tx ${tx} reverted (status ${r.status})`);
  return {
    version: RECEIPT_VERSION,
    network: args.network,
    chainId: args.chainId,
    resourceUrl: args.resourceUrl,
    payer: args.payer.toLowerCase(),
    payTo: args.payTo.toLowerCase(),
    asset: args.asset.toLowerCase(),
    amount: String(args.amount),
    issuedAt: args.issuedAt ?? Math.floor(Date.now() / 1000),
    transaction: tx,
    authorizationMethod: "",
    authorizationCommitment: "",
    read_at: { number: Number(BigInt(r.blockNumber)), hash: r.blockHash.toLowerCase() },
  };
}

export type VerifyResult =
  | "ok"
  | "malformed"
  | "wrong_network"
  | "reorged"
  | "wrong"
  | "incomplete";

export type VerifyReport = { result: VerifyResult; checks: string[]; reason?: string };

const topicAddr = (t: string | undefined) => (t ? `0x${t.slice(-40)}`.toLowerCase() : "");

/**
 * Point lookups only: eth_chainId, eth_getBlockByNumber(read_at.number), eth_getTransactionReceipt.
 *   reorged    = block at read_at.number exists but its hash differs (re-check, not a wrong answer)
 *   wrong      = block is canonical but the tx / USDC transfer it claims is not there as stated
 *   incomplete = the RPC could not answer; no verdict either way
 */
export async function verifyReceiptV2(receipt: unknown, rpcUrl?: string): Promise<VerifyReport> {
  const checks: string[] = [];
  const problems = receiptProblems(receipt);
  if (problems.length) return { result: "malformed", checks, reason: problems.join("; ") };
  const r = receipt as PaymentReceiptV2;
  const url = rpcUrl ?? DEFAULT_RPC[r.network];
  if (!url) return { result: "incomplete", checks, reason: `no RPC known for ${r.network}` };
  checks.push(`shape ok (version 2, ${r.network}, read_at well-formed)`);

  try {
    const cid = Number(BigInt(await rpc<string>(url, "eth_chainId", [])));
    if (cid !== r.chainId) return { result: "wrong_network", checks, reason: `RPC chainId ${cid} != receipt ${r.chainId}` };
    checks.push(`eth_chainId = ${cid}`);

    const block = await rpc<{ hash: string; number: string; timestamp: string; transactions: string[] } | null>(
      url,
      "eth_getBlockByNumber",
      [`0x${r.read_at.number.toString(16)}`, false],
    );
    if (!block) return { result: "incomplete", checks, reason: `block ${r.read_at.number} not available from RPC` };
    if (block.hash.toLowerCase() !== r.read_at.hash) {
      return {
        result: "reorged",
        checks,
        reason: `canonical hash at ${r.read_at.number} is ${block.hash.toLowerCase()}, receipt has ${r.read_at.hash}`,
      };
    }
    checks.push(`block ${r.read_at.number} canonical, hash matches (${new Date(Number(BigInt(block.timestamp)) * 1000).toISOString()})`);

    if (!block.transactions.map((t) => t.toLowerCase()).includes(r.transaction)) {
      return { result: "wrong", checks, reason: `tx ${r.transaction} is not in block ${r.read_at.number}` };
    }
    checks.push(`tx is in block (${block.transactions.length} txs)`);

    const tr = await fetchTxReceipt(url, r.transaction, { attempts: 1 });
    if (!tr) return { result: "incomplete", checks, reason: "tx receipt not available from RPC" };
    if (tr.blockHash.toLowerCase() !== r.read_at.hash) {
      return { result: "wrong", checks, reason: "tx receipt blockHash differs from read_at.hash" };
    }
    if (tr.status !== "0x1") return { result: "wrong", checks, reason: `tx status ${tr.status} (reverted)` };
    checks.push("tx status 0x1, receipt.blockHash = read_at.hash");

    const transfer = tr.logs.find(
      (l) =>
        l.address.toLowerCase() === r.asset &&
        l.topics[0]?.toLowerCase() === TRANSFER_TOPIC &&
        topicAddr(l.topics[1]) === r.payer &&
        topicAddr(l.topics[2]) === r.payTo &&
        BigInt(l.data) === BigInt(r.amount),
    );
    if (!transfer) {
      return { result: "wrong", checks, reason: `no Transfer(${r.payer} -> ${r.payTo}, ${r.amount}) from ${r.asset} in tx` };
    }
    checks.push(`Transfer(${r.payer} -> ${r.payTo}, ${r.amount}) at logIndex ${Number(BigInt(transfer.logIndex))}`);

    const auth = tr.logs.find(
      (l) => l.address.toLowerCase() === r.asset && l.topics[0]?.toLowerCase() === AUTHORIZATION_USED_TOPIC,
    );
    if (auth) checks.push(`AuthorizationUsed(${topicAddr(auth.topics[1])}) at logIndex ${Number(BigInt(auth.logIndex))} (EIP-3009)`);
    return { result: "ok", checks };
  } catch (e) {
    return { result: "incomplete", checks, reason: e instanceof Error ? e.message : String(e) };
  }
}
