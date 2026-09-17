# arc-x402-door

Tiny Next.js (App Router) **HTTP paid door** for Marcelo’s Arc Microgrant.

| Request | Result |
|--------|--------|
| No valid payment | **HTTP 402** + x402 `accepts` for **USDC on Arc Mainnet** via **Circle hosted Facilitator Service** |
| After facilitator settle | **200 JSON** evidence that **settle ≠ consent / purpose / agent authority** |

> Circle Facilitator Service verifies EIP-3009 authorizations only. It does **not** verify transaction purpose or confirm agent authority scope. Arc settlements are final.

## Stack

- **Next.js 15** App Router → simplest deploy on **Vercel**
- **`@x402/core` `HTTPFacilitatorClient`** patterns + direct `POST /settle`
- **Circle Facilitator Service**: `https://api.circle.com/v1/facilitator/x402`

Confirmed live (no auth):

```bash
curl -s https://api.circle.com/v1/facilitator/x402/supported | jq '.kinds[] | select(.network=="eip155:5042")'
```

| Field | Arc Mainnet |
|-------|-------------|
| CAIP-2 | `eip155:5042` |
| USDC | `0x3600000000000000000000000000000000000000` |
| Scheme | `exact` / EIP-3009 |
| Facilitator | Circle hosted |

Docs:

- https://developers.circle.com/facilitator-service
- https://developers.circle.com/facilitator-service/quickstart
- https://developers.circle.com/facilitator-service/supported-networks

## Quick start (local)

```bash
cd arc-x402-door
cp .env.example .env.local
# set PAY_TO=0xYourSellerAddress
# optional: CIRCLE_API_KEY=... for real settle
npm install
npm run dev
```

Unpaid (expect **402**):

```bash
curl -i http://localhost:3000/api/paid
```

Demo paid JSON shape (no live spend — DoraHacks screenshots only):

```bash
# in .env.local
ALLOW_DEMO_PAID=true

curl -i -H 'X-Arc-Door-Demo: paid' http://localhost:3000/api/paid
```

Build:

```bash
npm run build
npm start
```

`npm run build` does **not** require env vars (PAY_TO falls back to a placeholder address for static analysis). Set real `PAY_TO` before any smoke settle.

## Paid flow (wired)

1. Buyer hits `GET|POST /api/paid` → **402** + `PAYMENT-REQUIRED` (base64 JSON).
2. Buyer signs EIP-3009 `TransferWithAuthorization` against Arc USDC and retries with `PAYMENT-SIGNATURE`.
3. Server `POST`s to `{FACILITATOR_URL}/settle` with `Authorization: Bearer CIRCLE_API_KEY`.
4. On `success: true`, server returns evidence JSON + `PAYMENT-RESPONSE`.

### What’s wired vs stubbed

| Piece | Status |
|-------|--------|
| Real **402** body + `PAYMENT-REQUIRED` header | **Wired** |
| Arc Mainnet requirements (`eip155:5042`, USDC, exact/EIP-3009) | **Wired** |
| Facilitator URL default `https://api.circle.com/v1/facilitator/x402` | **Wired** (GET `/supported` verified 200) |
| `POST /settle` with Bearer `CIRCLE_API_KEY` | **Wired** (needs key + real signature for smoke) |
| Paid evidence JSON (`claim`, `evidence[]`, `settlement`) | **Wired** |
| Demo paid JSON (`ALLOW_DEMO_PAID` + header) | **Wired** (no chain) |
| Keyless trial `Facilitator-Seller-Proof` | **Stub / TODO** — see `lib/circle-facilitator.ts` `buildSellerProof` |
| `@x402/next` withX402 | Not used — peer needs Next >=16.2.6; route uses explicit settle + `@x402/core` |

### Exact facilitator endpoints

| Method | URL |
|--------|-----|
| GET | `https://api.circle.com/v1/facilitator/x402/supported` |
| POST | `https://api.circle.com/v1/facilitator/x402/verify` |
| POST | `https://api.circle.com/v1/facilitator/x402/settle` |
| GET | `https://api.circle.com/v1/facilitator/x402/status/{paymentId}` |

Auth for verify/settle: `Authorization: Bearer <CIRCLE_API_KEY>` **or** `Facilitator-Seller-Proof` (keyless trial).

## Env

See `.env.example`:

- `PAY_TO` — seller address
- `CIRCLE_API_KEY` — optional until live settle
- `FACILITATOR_URL` — default Circle hosted x402 base
- `NETWORK=arc-mainnet`
- `PRICE_USDC=0.01`
- `ALLOW_DEMO_PAID=false`

## Out of scope

Mandato AR · Base Sepolia · wallet funding · X publish · live spend

## Deploy (Vercel)

1. Import repo / folder.
2. Set env: `PAY_TO`, `FACILITATOR_URL`, `NETWORK`, `PRICE_USDC`, optionally `CIRCLE_API_KEY`.
3. Deploy. Hit `https://<project>.vercel.app/api/paid`.

## License

MIT
