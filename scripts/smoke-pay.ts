/**
 * Buyer smoke for the Arc x402 door.
 *
 *   npx tsx scripts/smoke-pay.ts                 # DRY RUN (default): GET → 402 → sign EIP-3009 → stop
 *   npx tsx scripts/smoke-pay.ts --preflight     # dry run + Circle /verify (no payment, no trial usage, nothing onchain)
 *   npx tsx scripts/smoke-pay.ts --live          # REAL: sends the paid request → facilitator settles 0.01 USDC on Arc Mainnet
 *
 * Flags:
 *   --url <door url>      default https://arc-x402-door.mswitach.workers.dev/api/paid (or DOOR_URL)
 *   --max-atomic <n>      refuse to sign above this amount (default 10000 = 0.01 USDC)
 *   --live                required to send the paid request (mainnet spend)
 *   --dry-run             explicit default; cannot be combined with --live
 *   --preflight           also call Circle POST /verify with a seller proof (needs seller key; spends nothing)
 *   --local-send          send the paid request even if unfunded, ONLY to a localhost door (rehearsal,
 *                         pair with SETTLE_DISABLED=true on the local server)
 *
 * The buyer key comes from BUYER_PRIVATE_KEY or ARC_WALLETS_FILE (`_private.buyerKey`). Never printed.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { verifyTypedData, getAddress, type Address, type Hex } from "viem";
import { x402Client } from "@x402/core/client";
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { buildSellerProof } from "../lib/circle-facilitator";
import {
  ARC_EXPLORER,
  ARC_MAINNET_CAIP2,
  ARC_MAINNET_CHAIN_ID,
  ARC_USDC,
  DEFAULT_DOOR_URL,
  artNow,
  balances,
  bigintReplacer,
  loadAccount,
  loadSellerKeyForProof,
  parseFlags,
  short,
} from "./_shared";

const FACILITATOR = process.env.FACILITATOR_URL?.trim() || "https://api.circle.com/v1/facilitator/x402";
const PLACEHOLDER = "0x0000000000000000000000000000000000000001";

function die(msg: string): never {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
}

function redactPayload(p: PaymentPayload) {
  const inner = p.payload as { signature?: string; authorization?: Record<string, string> };
  return {
    ...p,
    payload: {
      authorization: inner.authorization,
      signature: inner.signature ? short(inner.signature) + " (truncated)" : undefined,
    },
  };
}

async function main() {
  const flags = parseFlags();
  const live = flags.live === true;
  if (live && flags["dry-run"]) die("--live and --dry-run are mutually exclusive");
  const url = String(flags.url || process.env.DOOR_URL || DEFAULT_DOOR_URL);
  const maxAtomic = BigInt(String(flags["max-atomic"] ?? "10000"));
  const localSend = flags["local-send"] === true;
  if (localSend && !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) {
    die("--local-send only works against a localhost door");
  }
  if (localSend && live) die("--local-send and --live are mutually exclusive");

  console.log(`arc-x402-door smoke · ${artNow()} ART · mode=${live ? "LIVE" : "DRY-RUN"}`);
  console.log(`door: ${url}`);

  const buyer = loadAccount("buyer");
  console.log(`buyer: ${buyer.address}`);

  // 1) Unpaid request → expect 402 + PAYMENT-REQUIRED
  const r1 = await fetch(url, { headers: { accept: "application/json" } });
  console.log(`\n[1] GET (no payment) → HTTP ${r1.status}`);
  if (r1.status !== 402) die(`expected 402, got ${r1.status}: ${await r1.text()}`);
  const prHeader = r1.headers.get("payment-required");
  let paymentRequired: PaymentRequired;
  if (prHeader) {
    paymentRequired = decodePaymentRequiredHeader(prHeader);
    console.log("    PAYMENT-REQUIRED header decoded ✓");
  } else {
    paymentRequired = (await r1.json()) as PaymentRequired;
    console.log("    (no PAYMENT-REQUIRED header; using body)");
  }
  if (paymentRequired.x402Version !== 2) die(`x402Version ${paymentRequired.x402Version} ≠ 2`);

  // 2) Pick + sanity-check the Arc requirement against Circle /supported
  const req = paymentRequired.accepts.find(
    (a) => a.scheme === "exact" && a.network === ARC_MAINNET_CAIP2,
  ) as PaymentRequirements | undefined;
  if (!req) die(`no exact/${ARC_MAINNET_CAIP2} entry in accepts: ${JSON.stringify(paymentRequired.accepts)}`);
  const extra = (req.extra ?? {}) as Record<string, unknown>;
  const checks: [string, boolean][] = [
    [`network ${req.network} = ${ARC_MAINNET_CAIP2}`, req.network === ARC_MAINNET_CAIP2],
    [`asset ${req.asset} = USDC 0x3600…`, req.asset.toLowerCase() === ARC_USDC.toLowerCase()],
    [`amount ${req.amount} atomic (6 decimals) ≤ max ${maxAtomic}`, BigInt(req.amount) <= maxAtomic],
    [`extra.name "${extra.name}" = "USDC"`, extra.name === "USDC"],
    [`extra.version "${extra.version}" = "2"`, extra.version === "2"],
    [`payTo ${req.payTo} is not the placeholder`, req.payTo.toLowerCase() !== PLACEHOLDER],
  ];
  console.log("\n[2] payment requirements");
  for (const [label, ok] of checks) console.log(`    ${ok ? "✓" : "✖"} ${label}`);
  const hardFail = checks.slice(0, 5).some(([, ok]) => !ok);
  if (hardFail) die("requirements do not match Circle /supported for Arc Mainnet — not signing");
  const payToOk = checks[5][1];

  // 3) Sign EIP-3009 TransferWithAuthorization (local, no network)
  // Arc USDC is not in @x402's default-asset list, so opt it in explicitly with an atomic cap.
  const client = x402Client.fromConfig({
    schemes: [],
    spendControls: {
      allowedAssets: [
        { network: ARC_MAINNET_CAIP2, asset: ARC_USDC, maxAmountPerPayment: maxAtomic.toString() },
      ],
    },
  });
  registerExactEvmScheme(client, { signer: buyer, networks: [ARC_MAINNET_CAIP2] });
  const payload = await client.createPaymentPayload({ ...paymentRequired, accepts: [req] });
  const inner = payload.payload as {
    signature: Hex;
    authorization: { from: Address; to: Address; value: string; validAfter: string; validBefore: string; nonce: Hex };
  };
  const a = inner.authorization;
  const sigOk = await verifyTypedData({
    address: buyer.address,
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
    message: {
      from: getAddress(a.from),
      to: getAddress(a.to),
      value: BigInt(a.value),
      validAfter: BigInt(a.validAfter),
      validBefore: BigInt(a.validBefore),
      nonce: a.nonce,
    },
    signature: inner.signature,
  });
  console.log(`\n[3] EIP-3009 authorization signed by buyer — local signature check: ${sigOk ? "✓ valid" : "✖ INVALID"}`);
  console.log(JSON.stringify(redactPayload(payload), null, 2).replace(/^/gm, "    "));
  if (!sigOk) die("signature did not recover to buyer");
  const header = encodePaymentSignatureHeader(payload);
  console.log(`    PAYMENT-SIGNATURE header ready (${header.length} chars base64, not printed)`);

  // 4) Balances (read-only RPC)
  const bal = await balances(buyer.address);
  const funded = bal.usdcAtomic >= BigInt(req.amount);
  console.log(`\n[4] buyer balance on Arc Mainnet: ${bal.usdc} USDC (ERC-20, 6 dp) · native ${bal.native} · ${funded ? "✓ enough" : "✖ insufficient"}`);

  // 5) Optional preflight: Circle /verify (no payment, no trial usage, nothing onchain)
  if (flags.preflight) {
    const body = JSON.stringify({ x402Version: 2, paymentPayload: payload, paymentRequirements: req });
    const proof = await buildSellerProof({
      purpose: "verify",
      method: "POST",
      body,
      network: req.network,
      chainId: ARC_MAINNET_CHAIN_ID,
      payTo: req.payTo as Address,
      sellerPrivateKey: loadSellerKeyForProof(),
    });
    const vr = await fetch(`${FACILITATOR}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", "Facilitator-Seller-Proof": proof },
      body,
    });
    const vtext = await vr.text();
    console.log(`\n[5] preflight Circle POST /verify (seller proof) → HTTP ${vr.status}`);
    console.log(`    ${vtext}`);
  }

  if (!live && !localSend) {
    console.log("\nDRY RUN — paid request NOT sent. Only network calls: unpaid GET, read-only balance RPC" +
      (flags.preflight ? " and the /verify preflight." : "."));
    console.log("To settle for real (mainnet spend): npx tsx scripts/smoke-pay.ts --live");
    return;
  }

  // ---- LIVE (or local rehearsal) ----
  if (live && !payToOk) die("door advertises the placeholder payTo — refusing to pay");
  if (live && !funded) die(`buyer has ${bal.usdc} USDC < ${req.amount} atomic — fund ${buyer.address} on Arc Mainnet first`);

  console.log(`\n[6] ${live ? "LIVE" : "LOCAL REHEARSAL"}: GET with PAYMENT-SIGNATURE (amount ${req.amount} atomic → ${req.payTo})`);
  const t0 = Date.now();
  const r2 = await fetch(url, {
    headers: { accept: "application/json", "PAYMENT-SIGNATURE": header },
  });
  const ms = Date.now() - t0;
  const text = await r2.text();
  let json: unknown = text;
  try { json = JSON.parse(text); } catch { /* keep text */ }
  const prh = r2.headers.get("payment-response");
  const paymentResponse = prh ? decodePaymentResponseHeader(prh) : null;
  const tx =
    (paymentResponse?.transaction as string | undefined) ||
    ((json as { settlement?: { transactionHash?: string } })?.settlement?.transactionHash ?? null);

  console.log(`    HTTP ${r2.status} in ${ms} ms`);
  console.log(`    PAYMENT-RESPONSE: ${JSON.stringify(paymentResponse)}`);
  console.log(`    body: ${JSON.stringify(json, null, 2).replace(/\n/g, "\n    ")}`);
  if (tx) console.log(`\n    tx: ${tx}\n    explorer: ${ARC_EXPLORER}/tx/${tx}`);

  if (!live) {
    console.log("\n(local rehearsal — no evidence file written)");
    return;
  }
  mkdirSync("evidence", { recursive: true });
  const out = `evidence/smoke-live-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(
    out,
    JSON.stringify(
      {
        takenAtART: artNow(),
        door: url,
        buyer: buyer.address,
        requirement: req,
        unpaidStatus: r1.status,
        paidStatus: r2.status,
        latencyMs: ms,
        paymentResponse,
        transaction: tx,
        explorer: tx ? `${ARC_EXPLORER}/tx/${tx}` : null,
        body: json,
      },
      bigintReplacer,
      2,
    ),
  );
  console.log(`    saved ${out}`);
  if (r2.status !== 200) process.exit(2);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
