# DoraHacks submission — Arc Microgrants (Circle x DoraHacks)

Deadline: **2026-10-14 23:59 ET** (= 2026-10-15 00:59 ART). Submit from Marcelo's DoraHacks account (captcha).

## Title

**arc-x402-door: settle ≠ consent**

## One-liner

A paid x402 door on Arc Mainnet: pay 0.01 USDC through Circle's Facilitator Service and get back on-chain proof that settlement is not consent.

## How it uses Arc (≤ 600 chars)

<!-- keep this block ≤ 600 characters -->
Every paid request settles 0.01 USDC on Arc Mainnet (eip155:5042). The buyer signs an EIP-3009 authorization for Arc USDC, and Circle's Facilitator Service verifies and settles it. Gas is paid in USDC and Arc finality is sub-second and deterministic, so the door fulfills the moment it gets a tx hash. The paid response is JSON evidence with that tx hash, an Arc explorer link, and Circle's own disclaimer: the facilitator does not verify purpose or agent authority. Settle ≠ consent.

## Longer description

Agents paying in USDC is moving fast: Circle's Agent Stack, the hosted x402 Facilitator Service now live on Arc, and the agent-payment push in the Arc Weekly Recap. Settlement is getting easy. What it proves is narrow.

`arc-x402-door` is a minimal x402 v2 resource server. Unpaid requests get HTTP 402 with payment requirements that match Circle's `/supported` for Arc Mainnet field by field. A paid request carries a buyer-signed EIP-3009 `TransferWithAuthorization`. The door calls Circle `/verify` and `/settle`, and on success returns a receipt: the Arc tx hash, the explorer link, and sourced evidence (Circle docs, 2026-09-17) that the facilitator verifies signatures only, not transaction purpose or agent authority scope.

The point: a valid signature plus a final settle on Arc says the money moved. It does not say the agent was allowed to make that deal. That check is a separate layer, and this door makes the gap visible with real USDC on Arc.

Built with Next.js 15, `@x402/core`, `@x402/evm`, viem. Deployed on Cloudflare Workers. Includes a buyer smoke script (dry run by default, `--live` to pay) and a Plan B that settles the same authorization directly on Arc without the facilitator.

## Links

- Live demo: https://arc-x402-door.mswitach.workers.dev/api/paid
- Repo: https://github.com/mswitach/arc-x402-door
- Evidence pack: https://github.com/mswitach/arc-x402-door/blob/main/EVIDENCE.md
- Arc tx: `⏳ https://explorer.arc.io/tx/0x…` (fill after the live smoke)
- Builder GitHub: https://github.com/mswitach
- X: https://x.com/ai_evolve_all (@ai_evolve_all)

## Versión en español (opcional)

**Título:** arc-x402-door: liquidar no es consentir

**Una línea:** Una puerta paga x402 en Arc Mainnet. Pagás 0.01 USDC con el Facilitator Service de Circle y recibís la prueba on-chain de que liquidar no es consentir.

**Uso de Arc:** Cada request pago liquida 0.01 USDC en Arc Mainnet (eip155:5042). El comprador firma una autorización EIP-3009 sobre USDC de Arc y el Facilitator Service de Circle la verifica y la liquida. El gas se paga en USDC y la finalidad de Arc es determinística y de menos de un segundo, así que la puerta entrega apenas recibe el tx hash. La respuesta paga es un JSON con ese hash, el link al explorer de Arc y el propio disclaimer de Circle: el facilitator no verifica el propósito ni la autoridad del agente.

## Pre-submit checklist

- [ ] Live smoke done, tx hash + explorer link pasted above and in EVIDENCE.md
- [ ] Live door redeployed with `ALLOW_DEMO_PAID=false` (demo header returns 402)
- [ ] 402 + 200 + explorer screenshots attached
- [ ] Public copy check: no `¿` and no `;` in Spanish text
