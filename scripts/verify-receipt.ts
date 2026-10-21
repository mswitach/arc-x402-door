/**
 * Verify a receipt v2 against the chain with point lookups only (no eth_getLogs ranges).
 *
 *   npx tsx scripts/verify-receipt.ts <receipt.json | evidence.json> [--rpc <url>]
 *
 * Accepts a bare receipt, or any JSON that carries one at `.receipt`, `.settlement.receipt` or
 * `.body.settlement.receipt` (the door's paid response / smoke evidence files).
 *
 * Steps: shape → eth_chainId = chainId → eth_getBlockByNumber(read_at.number).hash = read_at.hash
 * → tx in that block → tx receipt status 1 in that block → USDC Transfer(payer → payTo, amount).
 *
 * Exit codes: 0 ok · 2 reorged (block at read_at.number no longer has that hash: re-check, not wrong)
 *             3 wrong (block canonical, payment not there as stated) · 4 incomplete (RPC could not answer)
 *             5 malformed / wrong_network
 */

import { readFileSync } from "node:fs";
import { parseFlags } from "./_shared";
import { verifyReceiptV2 } from "../lib/receipt";

const CODES = { ok: 0, reorged: 2, wrong: 3, incomplete: 4, malformed: 5, wrong_network: 5 } as const;

function pick(j: any): unknown {
  return j?.read_at ? j : (j?.receipt ?? j?.settlement?.receipt ?? j?.body?.settlement?.receipt ?? j);
}

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("usage: tsx scripts/verify-receipt.ts <receipt.json> [--rpc <url>]");
    process.exit(5);
  }
  const f = parseFlags();
  const receipt = pick(JSON.parse(readFileSync(file, "utf8")));
  const rep = await verifyReceiptV2(receipt, typeof f.rpc === "string" ? f.rpc : undefined);
  for (const c of rep.checks) console.log(`  ✓ ${c}`);
  console.log(`result: ${rep.result}${rep.reason ? ` (${rep.reason})` : ""}`);
  process.exit(CODES[rep.result]);
}

main().catch((e) => {
  console.error(`result: incomplete (${e instanceof Error ? e.message : String(e)})`);
  process.exit(4);
});
