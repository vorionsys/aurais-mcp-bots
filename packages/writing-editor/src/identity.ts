import type { DeriveInput } from "@vorionsys/aurais-core";

export const WRITING_EDITOR_IDENTITY: DeriveInput = {
  slug: "aurais-writing-editor",
  version: "0.1.0",
  name: "Aurais Writing Editor",
  tier: 3,
  maxEarnableTier: 4,
  capabilities: [
    "tool:structural_critique",
    "tool:sentence_critique",
    "tool:tone_audit",
    "data:read:user:draft-transient",
    "data:write:none",
    "safety:never_rewrites_prose",
    "api:post:api.anthropic.com",
    "runtime:mcp-stdio",
  ],
};
