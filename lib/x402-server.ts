/**
 * Shared x402ResourceServer pointing at Circle Facilitator Service (Arc).
 */

import { x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { createCircleFacilitatorClient } from "./circle-facilitator";
import { getConfig } from "./config";

let cached: x402ResourceServer | null = null;

export function getResourceServer(): x402ResourceServer {
  if (cached) return cached;
  const cfg = getConfig();
  const facilitator = createCircleFacilitatorClient(cfg);
  const server = new x402ResourceServer(facilitator).register(
    cfg.networkCaip2,
    new ExactEvmScheme(),
  );
  cached = server;
  return server;
}

export function routeAccepts() {
  const cfg = getConfig();
  return {
    scheme: "exact" as const,
    price: `$${cfg.priceUsdc}`,
    network: cfg.networkCaip2,
    payTo: cfg.payTo,
    maxTimeoutSeconds: 60,
    extra: {
      name: "USDC",
      version: "2",
      assetTransferMethod: "eip3009",
    },
  };
}
