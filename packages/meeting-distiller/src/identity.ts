import type { DeriveInput } from "@vorionsys/aurais-core";

// Reconstructed from dist/lib/car-identity.js — the source-tree car-identity.ts
// in the local clone (branch pre-split-capture-20260418) was truncated mid-IDENTITY.
// The compiled dist (built before the corruption) preserved the full constant.
export const MEETING_DISTILLER_IDENTITY: DeriveInput = {
  slug: "aurais-meeting-distiller",
  version: "0.1.0",
  name: "Aurais Meeting Distiller",
  tier: 3,
  observationClass: "BLACK_BOX",
  capabilities: [
    "tool:extract_decisions",
    "tool:extract_action_items",
    "tool:extract_open_questions",
    "data:read:user:transcript-transient",
    "data:write:none",
    "api:post:api.anthropic.com",
    "runtime:mcp-stdio",
  ],
};
