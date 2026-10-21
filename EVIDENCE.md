# EVIDENCE — arc-x402-door (Arc Microgrant · DoraHacks)

**Claim:** on x402, **settle ≠ consent**. Circle's hosted Facilitator Service settles a buyer-signed
EIP-3009 USDC authorization on Arc. It does **not** verify transaction purpose or agent authority scope.
This door charges real USDC on Arc Mainnet and returns that fact, with sources, as the paid response.

| | |
|---|---|
| Live door | https://arc-x402-door.mswitach.workers.dev/api/paid |
| Repo | https://github.com/mswitach/arc-x402-door |
| Network | Arc Mainnet · `eip155:5042` · chain id 5042 · explorer https://explorer.arc.io |
| Asset | USDC ERC-20 interface `0x3600000000000000000000000000000000000000` (6 decimals) |
| Price | 0.01 USDC = `10000` atomic |
| Scheme | x402 v2 `exact` · EIP-3009 `TransferWithAuthorization` |
| Facilitator | Circle Facilitator Service `https://api.circle.com/v1/facilitator/x402` |
| Seller (`payTo`) | `0x5B6134C5EbEc810a22402858C670D1cE34469c28` |
| Buyer (smoke) | `0x933C4b49ffe522879692CDc0f4868B6183Cc501c` |

> Status legend: ✅ captured · ⏳ placeholder until the live smoke runs

---

## 1. Live smoke result ✅ (Circle Facilitator, HTTP 200 settled)

| Item | Value |
|---|---|
| Smoke run at (ART) | `2026-10-14T23:21:47-03:00` |
| Command | `npm run smoke:live` |
| Unpaid status | ✅ `402` (see `evidence/live-402.txt`) |
| Paid status | ✅ `200` (`/verify` isValid true, `/settle` success true). Earlier attempts at 23:16 got `403 forbidden` before the Circle Console setup was completed |
| Latency (paid request incl. verify + settle) | 3711 ms |
| Facilitator auth mode | api-key |
| **Transaction hash** | `0x5f34e35062b2a1dd384476b6b9df695adc687f145f520445f1e1345110e01f8d` |
| **Explorer link** | https://explorer.arc.io/tx/0x5f34e35062b2a1dd384476b6b9df695adc687f145f520445f1e1345110e01f8d |
| Payer (from facilitator) | `0x933c4b49ffe522879692cdc0f4868b6183cc501c` |
| Raw output | `evidence/smoke-live-2026-10-15T02-21-47-800Z.json` · `evidence/live-200-smoke.txt` (earlier 403 runs: `evidence/smoke-live-2026-10-15T02-16-31-944Z.json`, `evidence/smoke-live-2026-10-15T02-17-20-864Z.json`) |

### Receipt v2 for the settle ✅

`read_at` = block **26020802**, hash `0xc37109c29f118ab1b73fbea94fd53993e8d6cc93c7181c153fe3a9f29b80067d`
(2026-10-14T23:21:45-03:00 ART), network `eip155:5042`. Receipt:
[`evidence/receipts/receipt-v2-0x5f34e350.json`](evidence/receipts/receipt-v2-0x5f34e350.json).
`npm run receipt:verify` on it returns `result: ok` (block hash matches, tx in block, USDC
`Transfer(0x933c…501c → 0x5b61…9c28, 10000)` at logIndex 4). Details are in [docs/RECEIPT-V2.md](docs/RECEIPT-V2.md).

### Screenshots ⏳

- `⏳ evidence/402.png` — `curl -i https://arc-x402-door.mswitach.workers.dev/api/paid` showing `HTTP/2 402` + `payment-required` header
- `⏳ evidence/200.png` — smoke output showing `HTTP 200`, `settlement.transactionHash`, `settlement.explorerLink`
- `⏳ evidence/explorer.png` — Arc explorer page for the tx (from buyer → payTo, 0.01 USDC)

### Plan B (secondary evidence, run while the facilitator returned 403) ✅

`npm run self-settle:live` — buyer submits `transferWithAuthorization` directly on Arc (no facilitator).
Tx hash `0x86e7d266242b7822e5780dd6a9e61cf24a1db8190e852e49da71fbd83bc70fc9` · explorer https://explorer.arc.io/tx/0x86e7d266242b7822e5780dd6a9e61cf24a1db8190e852e49da71fbd83bc70fc9 · status success, block 26020217, 0.01 USDC 0x933C…501c → 0x5B61…9c28 · raw `evidence/self-settle-live-2026-10-15T02-16-53-544Z.json`.
If Plan B is used, the evidence must say so: it proves USDC settle on Arc, not the Circle facilitator path.

---

## 2. Pre-funding rehearsal ✅ (2026-10-06, ART)

All of this ran **without spending anything** and without sending any transaction.

| Check | Result |
|---|---|
| `GET /supported` snapshot (10:22:40 ART) | ✅ HTTP 200 · Arc Mainnet kind matches the door exactly → [`evidence/facilitator-supported-2026-10-06.json`](evidence/facilitator-supported-2026-10-06.json) |
| Door 402 (local, `ALLOW_DEMO_PAID=false`) | ✅ `x402Version 2`, `exact`, `eip155:5042`, asset `0x3600…`, `amount 10000`, `extra {name: USDC, version: 2, assetTransferMethod: eip3009}`, `payTo` from env |
| Demo header with `ALLOW_DEMO_PAID=false` | ✅ `X-Arc-Door-Demo: paid` and `?demo=paid` both return **402** |
| Buyer EIP-3009 signature (`npm run smoke`, dry run) | ✅ signed with buyer key, recovers to buyer locally |
| Circle `POST /verify` with keyless seller proof (`npm run smoke:preflight`) | ✅ HTTP 200 `{"isValid":false,"invalidReason":"insufficient_funds","payer":"0x933c…501c"}` → auth, payload shape, EIP-712 domain, amount, payTo all accepted. Only blocker is buyer balance. `/verify` creates no payment, uses no trial allowance, sends nothing onchain. |
| Door real path (local, seller proof, `SETTLE_DISABLED=true`) | ✅ door → Circle `/verify` → `402 Payment invalid: insufficient_funds` (settle never called) |
| Plan B simulate (`npm run self-settle`, eth_call + estimateGas) | ✅ reverts with `ERC20: transfer amount exceeds balance` → calldata and signature are accepted by Arc USDC, only balance is missing |

---

## 3. Facilitator `/supported` snapshot ✅

Taken **2026-10-06 10:22:40 ART** (`GET https://api.circle.com/v1/facilitator/x402/supported` → 200):

```json
{
  "x402Version": 2,
  "scheme": "exact",
  "network": "eip155:5042",
  "asset": "0x3600000000000000000000000000000000000000",
  "decimals": 6,
  "extra": { "name": "USDC", "version": "2" }
}
```

Facilitator extensions advertised: `payment-identifier`, `settlement-status`. Full response in
[`evidence/facilitator-supported-2026-10-06.json`](evidence/facilitator-supported-2026-10-06.json).

---

## 4. Sources (with dates)

### a) Circle Facilitator Service — official disclaimer

- **Source:** https://developers.circle.com/facilitator-service
- **Date:** published 2026-09-17 · re-checked live 2026-10-06
- **Quote:**

> Facilitator Service verifies buyer-signed EIP-3009 USDC payment authorizations under the x402 protocol only — it does not hold, control, or transmit user funds, verify transaction purpose, or confirm agent authority scope. On Base and Polygon, settlements are subject to blockchain reorganization risk; Circle does not guarantee fund receipt. Arc settlements are final.

Supporting Circle pages (checked 2026-10-06):

- Keyless trial (settle without a Circle account, seller proof signed by the `payTo` key; mainnet and testnet allowances are separate) — https://developers.circle.com/facilitator-service/keyless-trial
- Sign a seller proof — https://developers.circle.com/facilitator-service/sign-seller-proof
- OpenAPI (`/verify` "without creating a payment, consuming keyless trial usage, or submitting anything onchain") — https://developers.circle.com/openapi/facilitator-service.yaml
- Supported networks — https://developers.circle.com/facilitator-service/supported-networks

### b) @402Signal — public signal

- **Source:** https://x.com/402Signal/status/2100545270157025304
- **Date:** 2026-09-17 · `created_at` 2026-09-17T11:19:53Z (= 08:19:53 ART)
- **Quote:**

> Circle just made Arc a real x402 rail, not a future roadmap item. Arc mainnet is live, and Circle’s hosted x402 facilitator now settles USDC across Arc, Base and Polygon. One detail matters: Circle says the facilitator doesn’t verify transaction purpose or agent authority scope. So settlement is getting easier. The independent “should this buyer sign this exact deal?” check is still a separate job.

### c) Arc network facts used

- USDC is the gas token, sub-second deterministic finality, 20 gwei `maxFeePerGas` floor, native USDC uses 18 decimals while the ERC-20 interface uses 6 — https://docs.arc.io/llms.txt · https://docs.arc.io/arc/references/evm-differences.md (checked 2026-10-06)

---

## 5. HTTP shapes

### Unpaid — `GET /api/paid` → 402

`PAYMENT-REQUIRED` header = base64 of the body:

```json
{
  "x402Version": 2,
  "error": "Payment required — USDC on Arc via Circle Facilitator Service (EIP-3009 exact)",
  "resource": { "url": "https://arc-x402-door.mswitach.workers.dev/api/paid", "description": "…", "mimeType": "application/json" },
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:5042",
    "amount": "10000",
    "asset": "0x3600000000000000000000000000000000000000",
    "payTo": "0x5B6134C5EbEc810a22402858C670D1cE34469c28",
    "maxTimeoutSeconds": 60,
    "extra": { "name": "USDC", "version": "2", "assetTransferMethod": "eip3009" }
  }]
}
```

### Paid — `PAYMENT-SIGNATURE` → verify → settle → 200

```json
{
  "claim": "settle ≠ consent / purpose / agent authority — …",
  "evidence": [ { "fuente": "https://developers.circle.com/facilitator-service", "fecha": "2026-09-17", "quote": "…" },
                { "fuente": "https://x.com/402Signal/status/2100545270157025304", "fecha": "2026-09-17 …", "quote": "…" } ],
  "settlement": {
    "network": "Arc Mainnet",
    "networkCaip2": "eip155:5042",
    "transactionHash": "0x…",
    "explorerLink": "https://explorer.arc.io/tx/0x…",
    "payer": "0x…",
    "facilitatorAuth": "api-key | seller-proof",
    "verify": { "isValid": true, "payer": "0x…" },
    "amountAtomic": "10000",
    "asset": "0x3600000000000000000000000000000000000000",
    "payTo": "0x5B6134C5EbEc810a22402858C670D1cE34469c28",
    "settledAt": "…",
    "note": "USDC moved on Arc … Settlement ≠ consent."
  },
  "meta": { "endpoint": "/api/paid", "x402Version": 2, "demo": false }
}
```

Plus a `PAYMENT-RESPONSE` header (base64 `{ success, transaction, network, payer }`).

---

## 6. Explicit non-claims

- The door does **not** implement purpose binding or agent-authority policy. It shows that the payment rail does not either.
- A facilitator settle is **not** consent to a deal’s purpose.
- No Base / Base Sepolia path in this pack.
