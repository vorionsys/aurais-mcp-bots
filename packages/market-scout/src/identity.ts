import type { DeriveInput } from "@vorionsys/aurais-core";

export const MARKET_SCOUT_IDENTITY: DeriveInput = {
  slug: "aurais-market-scout",
  version: "0.2.0",
  name: "Aurais Market Scout",
  tier: 3,
  observationClass: "BLACK_BOX",
  capabilities: [
    "tool:fetch_market_data",
    "tool:compute_indicators",
    "tool:generate_commentary",
    "data:read:market:public-quotes",
    "data:write:none",
    "api:get:finance.yahoo.com",
    "api:post:api.anthropic.com",
    "runtime:mcp-stdio",
  ],
};
