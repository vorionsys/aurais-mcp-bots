import type { DeriveInput } from "@vorionsys/aurais-core";

export const JOURNAL_COMPANION_IDENTITY: DeriveInput = {
  slug: "aurais-journal-companion",
  version: "0.1.0",
  name: "Aurais Journal Companion",
  tier: 3,
  maxEarnableTier: 4,
  capabilities: [
    "tool:analyze_journal_entry",
    "tool:generate_reflection",
    "data:read:user:journal-entry-transient",
    "data:write:none",
    "api:post:api.anthropic.com",
    "safety:crisis-content-response",
    "runtime:mcp-stdio",
  ],
};
