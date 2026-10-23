/**
 * Build a receipt v2 for an already-settled Arc payment (backfill), from public chain data only.
 *
 *   npx tsx scripts/build-receipt.ts --tx 0x5f34…01f8d [--resource-url <url>] [--issued-at <unix s>] [--out file.json]
 *
 * payer / payTo / amount come from the single USDC Transfer log in the tx. read_at comes from
 * eth_getTransactionReceipt (blockNumber, blockHash). issuedAt defaults to the block timestamp, so the
 * output is reproducible. No keys, no spend.
 */

import { writeFileSync } from "node:fs";
import { ARC_MAINNET_CAIP2, ARC_MAINNET_CHAIN_ID, ARC_RPC, ARC_USDC, DEFAULT_DOOR_URL, parseFlags } from "./_shared";
import { TRANSFER_TOPIC, buildReceiptV2, fetchTxReceipt, rpc } from "../lib/receipt";

function die(msg: string): never {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

async function main() {
  const f = parseFlags();
  const tx = typeof f.tx === "string" ? f.tx.toLowerCase() : die("--tx <hash> required");
  const asset = ARC_USDC.toLowerCase();
  const tr = await fetchTxReceipt(ARC_RPC, tx, { attempts: 1 });
  if (!tr) die(`no receipt for ${tx}`);
  const transfers = tr.logs.filter((l) => l.address.toLowerCase() === asset && l.topics[0]?.toLowerCase() === TRANSFER_TOPIC);
  if (transfers.length !== 1) die(`expected exactly one USDC Transfer in tx, found ${transfers.length}`);
  const t = transfers[0];
  const block = await rpc<{ timestamp: string }>(ARC_RPC, "eth_getBlockByHash", [tr.blockHash, false]);
  const receipt = await buildReceiptV2({
    rpcUrl: ARC_RPC,
    network: ARC_MAINNET_CAIP2,
    chainId: ARC_MAINNET_CHAIN_ID,
    resourceUrl: typeof f["resource-url"] === "string" ? f["resource-url"] : DEFAULT_DOOR_URL,
    payer: `0x${t.topics[1].slice(-40)}`,
    payTo: `0x${t.topics[2].slice(-40)}`,
    asset,
    amount: BigInt(t.data).toString(),
    transaction: tx,
    issuedAt: typeof f["issued-at"] === "string" ? Number(f["issued-at"]) : Number(BigInt(block.timestamp)),
  });
  const json = JSON.stringify(receipt, null, 2);
  if (typeof f.out === "string") {
    writeFileSync(f.out, json + "\n");
    console.error(`saved ${f.out}`);
  }
  console.log(json);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
