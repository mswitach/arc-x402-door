/**
 * Plan B: settle 0.01 USDC on Arc Mainnet WITHOUT the Circle facilitator.
 *
 * The buyer signs an EIP-3009 TransferWithAuthorization (same typed data the x402 door asks for)
 * and a submitter (buyer by default) calls USDC.transferWithAuthorization(...) directly on Arc,
 * paying gas in native USDC.
 *
 *   npx tsx scripts/self-settle.ts            # DRY RUN (default): sign + eth_call + estimateGas, no tx
 *   npx tsx scripts/self-settle.ts --live     # REAL: broadcasts the tx on Arc Mainnet (spends 0.01 USDC + gas)
 *
 * Flags:
 *   --to <address>        payTo (default: seller address from the wallets file)
 *   --amount <atomic>     default 10000 (= 0.01 USDC, 6 decimals); hard cap 10000 unless --max-atomic
 *   --max-atomic <n>      cap (default 10000)
 *   --submitter buyer|seller   who sends the tx and pays gas (default buyer)
 *   --live                required to broadcast
 *
 * Keys: BUYER_PRIVATE_KEY / SELLER_PRIVATE_KEY or ARC_WALLETS_FILE. Never printed.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  parseGwei,
  parseSignature,
  toHex,
  type Address,
} from "viem";
import type { PaymentReceiptV2 } from "../lib/receipt";
import {
  ARC_EXPLORER,
  ARC_MAINNET_CAIP2,
  ARC_MAINNET_CHAIN_ID,
  ARC_RPC,
  ARC_USDC,
  DEFAULT_WALLETS_FILE,
  arcMainnet,
  artNow,
  balances,
  bigintReplacer,
  loadAccount,
  parseFlags,
  publicClient,
  short,
} from "./_shared";

const MIN_FEE = parseGwei("20"); // Arc mempool floor for maxFeePerGas

const usdcAbi = [
  {
    type: "function",
    name: "transferWithAuthorization",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "authorizationState",
    stateMutability: "view",
    inputs: [
      { name: "authorizer", type: "address" },
      { name: "nonce", type: "bytes32" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

function die(msg: string): never {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
}

function errMsg(e: unknown): string {
  const anyE = e as { shortMessage?: string; details?: string; message?: string };
  return [anyE.shortMessage, anyE.details].filter(Boolean).join(" | ") || String(anyE.message ?? e);
}

async function main() {
  const flags = parseFlags();
  const live = flags.live === true;
  if (live && flags["dry-run"]) die("--live and --dry-run are mutually exclusive");

  const wallets = JSON.parse(
    readFileSync(process.env.ARC_WALLETS_FILE?.trim() || DEFAULT_WALLETS_FILE, "utf8"),
  ) as { seller?: { address?: string } };
  const to = getAddress(String(flags.to || wallets.seller?.address || die("no --to and no seller.address")));
  const amount = BigInt(String(flags.amount ?? "10000"));
  const maxAtomic = BigInt(String(flags["max-atomic"] ?? "10000"));
  if (amount <= 0n || amount > maxAtomic) die(`amount ${amount} outside (0, ${maxAtomic}]`);

  const buyer = loadAccount("buyer");
  const submitterRole = flags.submitter === "seller" ? "seller" : "buyer";
  const submitter = submitterRole === "seller" ? loadAccount("seller") : buyer;

  console.log(`arc-x402-door self-settle (Plan B) · ${artNow()} ART · mode=${live ? "LIVE" : "DRY-RUN"}`);
  console.log(`rpc ${ARC_RPC} · chain ${await publicClient.getChainId()} (expect ${ARC_MAINNET_CHAIN_ID})`);
  console.log(`from (buyer) ${buyer.address} → to ${to} · ${amount} atomic USDC · submitter ${submitterRole} ${submitter.address}`);

  // 1) Sign EIP-3009 TransferWithAuthorization (local)
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 600);
  const message = { from: buyer.address, to, value: amount, validAfter: 0n, validBefore, nonce };
  const signature = await buyer.signTypedData({
    domain: { name: "USDC", version: "2", chainId: ARC_MAINNET_CHAIN_ID, verifyingContract: ARC_USDC },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message,
  });
  const { v, r, s, yParity } = parseSignature(signature);
  const vNum = Number(v ?? BigInt(yParity + 27));
  console.log(`\n[1] authorization signed (sig ${short(signature)}), nonce ${short(nonce)}, validBefore ${validBefore}`);

  const args = [message.from, message.to, message.value, message.validAfter, message.validBefore, nonce, vNum, r, s] as const;
  const data = encodeFunctionData({ abi: usdcAbi, functionName: "transferWithAuthorization", args });
  console.log(`[2] calldata built: transferWithAuthorization (${data.length / 2 - 1} bytes) → ${ARC_USDC}`);

  // 2) Read-only checks
  const [bBuyer, bSub, used] = await Promise.all([
    balances(buyer.address),
    submitter.address === buyer.address ? null : balances(submitter.address),
    publicClient.readContract({ address: ARC_USDC, abi: usdcAbi, functionName: "authorizationState", args: [buyer.address, nonce] }),
  ]);
  console.log(`[3] buyer ${bBuyer.usdc} USDC (6dp) / native ${bBuyer.native}` + (bSub ? ` · submitter native ${bSub.native}` : ""));
  console.log(`    authorizationState(nonce) = ${used} (expect false)`);

  // 3) Simulate (eth_call) + estimateGas — no tx
  let simOk = false;
  try {
    await publicClient.call({ account: submitter.address, to: ARC_USDC, data });
    simOk = true;
    console.log(`[4] eth_call simulate: ✓ would succeed`);
  } catch (e) {
    console.log(`[4] eth_call simulate: ✖ reverted — ${errMsg(e)}`);
  }
  let gas: bigint | null = null;
  try {
    gas = await publicClient.estimateGas({ account: submitter.address, to: ARC_USDC, data });
    console.log(`    estimateGas: ${gas}`);
  } catch (e) {
    console.log(`    estimateGas: ✖ ${errMsg(e)}`);
  }
  const fees = await publicClient.estimateFeesPerGas().catch(() => null);
  const maxFeePerGas = fees?.maxFeePerGas && fees.maxFeePerGas > MIN_FEE ? fees.maxFeePerGas : MIN_FEE;
  const maxPriorityFeePerGas = fees?.maxPriorityFeePerGas ?? 1n;
  console.log(`    fees: maxFeePerGas ${maxFeePerGas} wei (floor 20 gwei), priority ${maxPriorityFeePerGas}`);

  if (!live) {
    console.log("\nDRY RUN — nothing broadcast. Expected to revert while the buyer has 0 USDC.");
    console.log("To broadcast for real (mainnet spend): npx tsx scripts/self-settle.ts --live");
    return;
  }

  if (!simOk || gas === null) die("simulation failed — refusing to broadcast");
  if (bBuyer.usdcAtomic < amount) die("buyer USDC balance below amount");

  const wallet = createWalletClient({ account: submitter, chain: arcMainnet, transport: http(ARC_RPC) });
  const hash = await wallet.sendTransaction({
    to: ARC_USDC,
    data,
    gas: (gas * 12n) / 10n,
    maxFeePerGas,
    maxPriorityFeePerGas: maxPriorityFeePerGas > maxFeePerGas ? maxFeePerGas : maxPriorityFeePerGas,
  });
  console.log(`\n[5] LIVE tx sent: ${hash}\n    ${ARC_EXPLORER}/tx/${hash}`);
  const t0 = Date.now();
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`    status ${receipt.status} · block ${receipt.blockNumber} · ${Date.now() - t0} ms to receipt`);

  const receiptV2: PaymentReceiptV2 = {
    version: 2,
    network: ARC_MAINNET_CAIP2,
    chainId: ARC_MAINNET_CHAIN_ID,
    resourceUrl: "plan-b:self-settle",
    payer: buyer.address.toLowerCase(),
    payTo: to.toLowerCase(),
    asset: ARC_USDC.toLowerCase(),
    amount: amount.toString(),
    issuedAt: Math.floor(Date.now() / 1000),
    transaction: hash.toLowerCase(),
    authorizationMethod: "",
    authorizationCommitment: "",
    read_at: { number: Number(receipt.blockNumber), hash: receipt.blockHash.toLowerCase() },
  };
  console.log(`    receipt v2 read_at: ${JSON.stringify(receiptV2.read_at)}`);

  mkdirSync("evidence", { recursive: true });
  const out = `evidence/self-settle-live-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(
    out,
    JSON.stringify(
      {
        takenAtART: artNow(),
        mode: "plan-b-self-settle",
        from: buyer.address,
        to,
        amountAtomic: amount,
        submitter: submitter.address,
        transaction: hash,
        explorer: `${ARC_EXPLORER}/tx/${hash}`,
        status: receipt.status,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed,
        effectiveGasPrice: receipt.effectiveGasPrice,
        receipt: receiptV2,
      },
      bigintReplacer,
      2,
    ),
  );
  console.log(`    saved ${out}`);
}

main().catch((e) => die(errMsg(e)));
