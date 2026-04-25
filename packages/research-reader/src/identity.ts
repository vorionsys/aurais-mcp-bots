import type { DeriveInput } from "@vorionsys/aurais-core";

export const RESEARCH_READER_IDENTITY: DeriveInput = {
  slug: "aurais-research-reader",
  version: "0.1.0",
  name: "Aurais Research Reader",
  tier: 3,
  maxEarnableTier: 4,
  capabilities: [
    "tool:extract_thesis",
    "tool:extract_claims_with_quotes",
    "tool:verify_quotes_verbatim",
    "data:read:user:source-text-transient",
    "data:write:none",
    "api:post:api.anthropic.com",
    "runtime:mcp-stdio",
  ],
};
