# Live smoke with @x402 2.28.0 client — 2026-10-23

- Run at: 2026-10-23 10:35 ART (settledAt 2026-10-23T13:35:40.591Z)
- Command: `npm run smoke:live -- --max-atomic 10000` (client @x402/core + @x402/evm 2.28.0, main @ 1cb9f36)
- Door: https://arc-x402-door.mswitach.workers.dev/api/paid (production Worker NOT redeployed: server side still 2.26.0)
- Unpaid: 402 · Paid: 200 · facilitator verify isValid true, settle success true (Circle Facilitator, api-key mode)
- Tx: 0xf99cbea9ad7ca560d8b3e0921010439636f76fea933e71b536bbaa833f9d5938
- Explorer: https://explorer.arc.io/tx/0xf99cbea9ad7ca560d8b3e0921010439636f76fea933e71b536bbaa833f9d5938
- Block: 27461569 · hash 0xcb6a02c047af7eac658f2d4afab53708819426d40911cfded35d37c0af51aee6 · status 0x1
- Amount: 10000 atomic (0.01 USDC) 0x933C…501c -> 0x5B61…9c28
- Buyer USDC balance: 4.957757 before -> 4.947757 after
- Receipt: `evidence/receipts/receipt-v2-0xf99cbea9.json`, built with the receipt v2 tooling from PR #1
  (branch feat/receipt-v2-read-at, NOT merged; format `read_at {number, hash}` + `network`/`chainId`).

## `verify-receipt.ts` output (PR #1 tooling)

```
  ✓ shape ok (version 2, eip155:5042, read_at well-formed)
  ✓ eth_chainId = 5042
  ✓ block 27461569 canonical, hash matches (2026-10-23T13:35:39.000Z)
  ✓ tx is in block (3 txs)
  ✓ tx status 0x1, receipt.blockHash = read_at.hash
  ✓ Transfer(0x933c4b49ffe522879692cdc0f4868b6183cc501c -> 0x5b6134c5ebec810a22402858c670d1ce34469c28, 10000) at logIndex 2
  ✓ AuthorizationUsed(0x933c4b49ffe522879692cdc0f4868b6183cc501c) at logIndex 0 (EIP-3009)
result: ok
```
