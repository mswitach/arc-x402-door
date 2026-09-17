# EVIDENCE — Arc Microgrant pack (DoraHacks)

**Project:** `arc-x402-door`  
**Claim:** Circle hosted x402 Facilitator Service **settlement ≠ purpose / agent-authority verification**.  
**Network:** Arc Mainnet (`eip155:5042`) · **Asset:** USDC · **Scheme:** exact / EIP-3009  
**Facilitator:** Circle Facilitator Service · `https://api.circle.com/v1/facilitator/x402`

---

## 1. One-liner

Unpaid → HTTP 402 (x402). Paid (after Circle settle) → JSON proving the door can charge USDC on Arc while the facilitator still does **not** verify purpose or agent authority scope.

## 2. Primary citations

### a) Circle Facilitator Service (official)

- **Fuente:** https://developers.circle.com/facilitator-service  
- **Fecha:** 2026-09-17 (docs live; service announcement same day)  
- **Quote:**

> Facilitator Service verifies buyer-signed EIP-3009 USDC payment authorizations under the x402 protocol only — it does not hold, control, or transmit user funds, verify transaction purpose, or confirm agent authority scope.  
> On Base and Polygon, settlements are subject to blockchain reorganization risk; Circle does not guarantee fund receipt. **Arc settlements are final.**

Supporting pages:

- Quickstart settle URL: `POST https://api.circle.com/v1/facilitator/x402/settle` — https://developers.circle.com/facilitator-service/quickstart  
- Supported networks (Arc Mainnet `eip155:5042`, USDC `0x3600…0000`) — https://developers.circle.com/facilitator-service/supported-networks  
- How it works (roles, EIP-3009 only) — https://developers.circle.com/facilitator-service/how-it-works  

### b) @402Signal (public signal)

- **Fuente:** https://x.com/402Signal/status/2100545270157025304  
- **Fecha:** 2026-09-17 ART / UTC — `created_at` **2026-09-17T11:19:53Z** (= **08:19:53 ART**)  
- **Quote (note_tweet):**

> Circle just made Arc a real x402 rail, not a future roadmap item.  
> Arc mainnet is live, and Circle’s hosted x402 facilitator now settles USDC across Arc, Base and Polygon.  
> One detail matters: Circle says the facilitator doesn’t verify transaction purpose or agent authority scope.  
> So settlement is getting easier. The independent “should this buyer sign this exact deal?” check is still a separate job.

## 3. HTTP shapes (this repo)

### Unpaid — `GET /api/paid` → 402

Headers include `PAYMENT-REQUIRED` (base64 of body). Body includes `x402Version: 2` and `accepts[]` with:

- `scheme: "exact"`
- `network: "eip155:5042"`
- `asset: "0x3600000000000000000000000000000000000000"`
- `payTo: <PAY_TO>`
- `extra.name/version`: USDC / 2 · `assetTransferMethod: eip3009`

### Paid — 200 JSON

```json
{
  "claim": "settle ≠ consent / purpose / agent authority — …",
  "evidence": [
    { "fuente": "https://developers.circle.com/facilitator-service", "fecha": "2026-09-17", "quote": "…" },
    { "fuente": "https://x.com/402Signal/status/2100545270157025304", "fecha": "2026-09-17 (created_at 2026-09-17T11:19:53Z / 08:19:53 ART)", "quote": "…" }
  ],
  "settlement": {
    "network": "Arc Mainnet",
    "networkCaip2": "eip155:5042",
    "scheme": "exact / EIP-3009",
    "facilitator": "Circle hosted Facilitator Service",
    "facilitatorUrl": "https://api.circle.com/v1/facilitator/x402",
    "transactionHash": null,
    "payer": null,
    "amountAtomic": "10000",
    "asset": "0x3600000000000000000000000000000000000000",
    "payTo": "0x…",
    "settledAt": null,
    "note": "Placeholder until real smoke settle — or filled from facilitator success.transaction"
  }
}
```

Demo (no live spend): `ALLOW_DEMO_PAID=true` + header `X-Arc-Door-Demo: paid`.

## 4. Smoke checklist (when ready — out of scope for this scaffold)

- [ ] Set `PAY_TO` + `CIRCLE_API_KEY` (or seller proof)
- [ ] Buyer wallet with Arc Mainnet USDC
- [ ] Unpaid curl → 402
- [ ] Paid retry with `PAYMENT-SIGNATURE` → 200 + non-null `settlement.transactionHash`
- [ ] Screenshot 402 + 200 for DoraHacks pack

## 5. Explicit non-claims

- This door does **not** implement Mandato AR / purpose binding / agent-authority policy.
- Facilitator settle is **not** consent to a deal’s purpose.
- No Base Sepolia path in this pack.
