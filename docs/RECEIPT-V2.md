# Receipt v2: tx hash + `read_at` block locator

After a settle, the door returns `settlement.receipt` in the paid JSON. It carries the tx hash, the block the
settlement landed in (`read_at: {number, hash}`) and the network (CAIP-2 + chain id). A verifier goes
straight to that block with point lookups. It never needs an `eth_getLogs` range, which Arc's public RPC caps at
10k blocks. The block hash separates two failure modes: **reorged** (that height now has another hash, so
re-check) and **wrong** (the block is canonical but the payment is not in it as stated).

## Format

```jsonc
{
  "version": 2,                       // int
  "network": "eip155:5042",           // CAIP-2 (Arc Mainnet)
  "chainId": 5042,                    // int, must equal the CAIP-2 reference
  "resourceUrl": "https://…/api/paid",
  "payer":  "0x…",                    // lower-case address
  "payTo":  "0x…",                    // lower-case address
  "asset":  "0x3600000000000000000000000000000000000000", // USDC ERC-20 interface on Arc
  "amount": "10000",                  // atomic, decimal string (6 decimals)
  "issuedAt": 1792030905,             // unix seconds
  "transaction": "0x…",               // 0x + 64 lower-case hex
  "authorizationMethod": "",          // x402#3827 v2 fields, "" = no commitment
  "authorizationCommitment": "",
  "read_at": { "number": 26020802,    // int (JSON number, not hex string)
               "hash": "0x…" }        // 0x + 64 lower-case hex
}
```

### Alignment sources

- **`read_at`**: same keys, types and encoding as `x402-receipt-private-opening/1` by Federico Blanco
  Sánchez-Llanos. The validator `_read_at_ok` requires exactly the keys `{number, hash}`, `number` an int ≥ 0,
  and `hash` = `0x` + 64 lower-case hex:
  [statement.py L97-L110](https://github.com/babyblueviper1/preaction-governance-conformance/blob/3243d33077d75a13c07eea1e05901101acdb316b/examples/x402-receipt-private-opening/statement.py#L97-L110), described in [README.md L26-L43](https://github.com/babyblueviper1/preaction-governance-conformance/blob/3243d33077d75a13c07eea1e05901101acdb316b/examples/x402-receipt-private-opening/README.md#L26-L43).
  Our receipt passes that function unchanged (`_read_at_ok(receipt["read_at"]) == True`).
- **`version`, `network` (CAIP-2), `resourceUrl`, `payer`, `issuedAt`, `transaction`,
  `authorizationMethod`, `authorizationCommitment`**: the x402 receipt payload v2 table in
  [x402-foundation/x402#3827](https://github.com/x402-foundation/x402/pull/3827)
  ([spec L281-L290](https://github.com/x402-foundation/x402/blob/fe777a4e02f3b55e76a246f17bc3ddc616ba3a9c/specs/extensions/extension-offer-and-receipt.md#L281-L290)). The statement copies `network` from the receipt
  ([statement.py L112](https://github.com/babyblueviper1/preaction-governance-conformance/blob/3243d33077d75a13c07eea1e05901101acdb316b/examples/x402-receipt-private-opening/statement.py#L112)), so the chain lives in `network` as CAIP-2. `chainId` is an
  extra integer copy for consumers that want it without parsing.
- **Additions** for a standalone check: `payTo`, `asset`, `amount`, `chainId`.

### One semantic difference, on purpose

In the private-opening statement, `read_at` is the **chain head** the verifier read through. It is never the
settlement block, because that statement must not point at the settlement (privacy rule,
[statement.py L18-L22](https://github.com/babyblueviper1/preaction-governance-conformance/blob/3243d33077d75a13c07eea1e05901101acdb316b/examples/x402-receipt-private-opening/statement.py#L18-L22)). This receipt already names its transaction in the
clear, so pointing at the settlement block leaks nothing new and gives the shortest verification path. The shape is
identical, and the reorg test is the same (the hash at `read_at.number` is no longer canonical, so the result is
`reorged`).

This receipt is unsigned. It is a self-describing record, not the EIP-712/JWS-signed receipt of the offer-receipt
extension.

## Backwards compatibility

The change is additive. Every v1 field of the paid JSON is unchanged. `settlement.receipt` is new (null in demo
mode, or with `settlement.receiptError` if the RPC did not return the tx receipt in time; delivery is never blocked
on it). `meta.receiptVersion = 2` marks responses that carry it.

## Tools

```bash
npm run receipt:build  -- --tx <hash> [--out file.json]   # backfill from public chain data
npm run receipt:verify -- <receipt.json | evidence.json>  # point lookups only
```

`verify-receipt` runs these checks in order:
1. shape
2. `eth_chainId` = `chainId`
3. `eth_getBlockByNumber(read_at.number).hash` = `read_at.hash`
4. tx ∈ block
5. tx receipt status 1, `blockHash` = `read_at.hash`
6. USDC `Transfer(payer → payTo, amount)` in that tx

Exit codes: `0` ok · `2` reorged · `3` wrong · `4` incomplete (RPC could not answer, no verdict) · `5` malformed.

## Real example: facilitator settle on Arc Mainnet

Built with `scripts/build-receipt.ts` from tx `0x5f34e350…01f8d`. Every value comes from the RPC; `issuedAt` is
the block timestamp, so the output is reproducible. File:
[`evidence/receipts/receipt-v2-0x5f34e350.json`](../evidence/receipts/receipt-v2-0x5f34e350.json).

```json
{
  "version": 2,
  "network": "eip155:5042",
  "chainId": 5042,
  "resourceUrl": "https://arc-x402-door.mswitach.workers.dev/api/paid",
  "payer": "0x933c4b49ffe522879692cdc0f4868b6183cc501c",
  "payTo": "0x5b6134c5ebec810a22402858c670d1ce34469c28",
  "asset": "0x3600000000000000000000000000000000000000",
  "amount": "10000",
  "issuedAt": 1792030905,
  "transaction": "0x5f34e35062b2a1dd384476b6b9df695adc687f145f520445f1e1345110e01f8d",
  "authorizationMethod": "",
  "authorizationCommitment": "",
  "read_at": {
    "number": 26020802,
    "hash": "0xc37109c29f118ab1b73fbea94fd53993e8d6cc93c7181c153fe3a9f29b80067d"
  }
}
```

```
$ npx tsx scripts/verify-receipt.ts evidence/receipts/receipt-v2-0x5f34e350.json
  ✓ shape ok (version 2, eip155:5042, read_at well-formed)
  ✓ eth_chainId = 5042
  ✓ block 26020802 canonical, hash matches (2026-10-15T02:21:45.000Z)
  ✓ tx is in block (13 txs)
  ✓ tx status 0x1, receipt.blockHash = read_at.hash
  ✓ Transfer(0x933c4b49ffe522879692cdc0f4868b6183cc501c -> 0x5b6134c5ebec810a22402858c670d1ce34469c28, 10000) at logIndex 4
  ✓ AuthorizationUsed(0x933c4b49ffe522879692cdc0f4868b6183cc501c) at logIndex 2 (EIP-3009)
result: ok
```

Negative checks run against the same receipt:
- `read_at.hash` replaced: `reorged`, exit 2.
- `amount` "20000": `wrong` (no matching Transfer), exit 3.
- Upper-case hash: `malformed`, exit 5.
