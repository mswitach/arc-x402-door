# arc-x402-door

A paid HTTP door on **Arc Mainnet**. Pay 0.01 USDC over **x402**, get back a JSON receipt that
proves a point most agent-payment demos skip: **settlement is not consent**.

| Request to `/api/paid` | Result |
|---|---|
| No payment | **HTTP 402** + x402 v2 `PAYMENT-REQUIRED` for USDC on Arc Mainnet |
| Valid `PAYMENT-SIGNATURE` | Circle Facilitator Service **verifies + settles** on Arc → **200** evidence JSON with tx hash + explorer link |

Live: https://arc-x402-door.mswitach.workers.dev/api/paid

## Why: settle ≠ consent

Circle and Arc are pushing hard on agents paying in USDC (Circle's
[Agent Stack](https://developers.circle.com/agent-stack), the hosted x402 Facilitator Service, and the
agent-payment items in the Arc Weekly Recap). Settlement keeps getting easier. But Circle's own
Facilitator Service docs are explicit:

> Facilitator Service verifies buyer-signed EIP-3009 USDC payment authorizations under the x402
> protocol only — it does not hold, control, or transmit user funds, verify transaction purpose, or
> confirm agent authority scope. […] Arc settlements are final.
> — https://developers.circle.com/facilitator-service

So when an agent pays, a valid signature + a final settle on Arc tell you **the money moved**. They
do not tell you **why** it moved or whether the agent **was allowed to** sign that deal. That check is a
separate layer. This door makes the gap concrete: the thing you buy is the evidence of the gap,
delivered over the very rail that has it.

## What Arc is used for

- **USDC settlement on Arc Mainnet** (`eip155:5042`): the buyer's EIP-3009 `TransferWithAuthorization`
  moves 0.01 USDC (`10000` atomic, ERC-20 interface at `0x3600…0000`, 6 decimals) to the seller.
- **Gas in USDC**: Arc's native gas token is USDC, so the whole flow (and the Plan B self-settle) is
  priced in dollars. No second token.
- **Sub-second, deterministic finality**: "Arc settlements are final", so the door can fulfill as soon as
  the facilitator returns a tx hash. No confirmation wait, no reorg risk.
- **Circle Facilitator Service** settles on Arc through a Circle relayer, so the buyer needs only USDC.

## How it works

1. `GET /api/paid` → **402**, `PAYMENT-REQUIRED` (base64 JSON, x402 v2):
   `scheme exact`, `network eip155:5042`, `asset 0x3600…`, `amount 10000`,
   `extra { name: "USDC", version: "2", assetTransferMethod: "eip3009" }`, `payTo` from env.
   These match Circle's `GET /supported` for Arc Mainnet field by field
   ([snapshot](evidence/facilitator-supported-2026-10-06.json)).
2. Buyer signs EIP-3009 against the USDC EIP-712 domain (`USDC` / `2` / chain 5042) and retries with
   `PAYMENT-SIGNATURE`.
3. Door checks the buyer's `accepted` terms equal what it advertised, then calls Circle
   `POST /verify` and `POST /settle` (auth: `Authorization: Bearer CIRCLE_API_KEY`, or the keyless-trial
   `Facilitator-Seller-Proof` signed by the `payTo` key).
4. On terminal success → **200** evidence JSON (`claim`, sourced `evidence[]`, `settlement.transactionHash`,
   `settlement.explorerLink`) + `PAYMENT-RESPONSE`. Pending → 202 (not fulfilled). Failure → 402.

Code: [`app/api/paid/route.ts`](app/api/paid/route.ts) · [`lib/config.ts`](lib/config.ts) ·
[`lib/circle-facilitator.ts`](lib/circle-facilitator.ts) · [`lib/evidence.ts`](lib/evidence.ts)

## Run

```bash
npm ci
cp .env.example .env.local   # set PAY_TO and ONE of CIRCLE_API_KEY / SELLER_PRIVATE_KEY
npm run dev                  # or: npm run build && npm start
curl -i http://localhost:3000/api/paid          # → 402
```

Env (see [`.env.example`](.env.example)):

| Var | Purpose |
|---|---|
| `PAY_TO` | seller address. Unset → 402 shows a placeholder and the door refuses to settle |
| `CIRCLE_API_KEY` | Circle Console key (`LIVE_API_KEY:…` for mainnet) → Bearer auth |
| `SELLER_PRIVATE_KEY` | alternative: keyless trial, signs `Facilitator-Seller-Proof` (must control `PAY_TO`) |
| `ALLOW_DEMO_PAID` | `true` → `X-Arc-Door-Demo: paid` returns the paid JSON shape with no settle (screenshots only). **Must be `false` for the real smoke** |
| `SETTLE_DISABLED` | `true` → run `/verify` only, never `/settle` (rehearsal) |
| `PRICE_USDC` / `NETWORK` / `FACILITATOR_URL` | `0.01` / `arc-mainnet` / Circle hosted base |

Deploy: Cloudflare Workers via OpenNext (`npm run deploy`, see `wrangler.jsonc`). Secrets
(`CIRCLE_API_KEY` or `SELLER_PRIVATE_KEY`) go in as Workers secrets, never in `vars` or git.

## Smoke scripts (buyer side)

Keys are read at runtime from `BUYER_PRIVATE_KEY` / `SELLER_PRIVATE_KEY` or a wallets JSON at
`ARC_WALLETS_FILE`. They are never printed or written.

```bash
npm run smoke              # DRY RUN: GET → 402 → check terms → sign EIP-3009 → stop (no spend)
npm run smoke:preflight    # + Circle POST /verify with seller proof (no payment, no trial usage, nothing onchain)
npm run smoke:live         # REAL: sends the paid request → 0.01 USDC settles on Arc Mainnet
```

`smoke-pay.ts` refuses to send the paid request without `--live`, refuses to sign above
`--max-atomic` (default 10000 = 0.01 USDC), refuses a placeholder `payTo`, and checks the buyer's USDC
balance before paying. Live runs save `evidence/smoke-live-<timestamp>.json`.
`--url http://localhost:3000/api/paid --local-send` rehearses the paid request against a local door.

**Plan B** (no facilitator): `npm run self-settle` builds + signs `transferWithAuthorization` and only
simulates it (`eth_call` + `estimateGas`). `npm run self-settle:live` broadcasts it from the buyer,
paying gas in USDC (≥ 20 gwei `maxFeePerGas`).

## Evidence

See [EVIDENCE.md](EVIDENCE.md) for the 402/200 captures, tx hash, explorer link, sources with dates,
and the pre-funding rehearsal log. DoraHacks copy: [docs/DORAHACKS.md](docs/DORAHACKS.md).

## Scope

Out of scope here: purpose binding / agent-authority policy (that is the point), Base / Base Sepolia.

## License

MIT
