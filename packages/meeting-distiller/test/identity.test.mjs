import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveAgentIdentity } from "@vorionsys/aurais-core";
import { MEETING_DISTILLER_IDENTITY } from "../dist/identity.js";

// This file's IDENTITY constant was reconstructed from dist/lib/car-identity.js
// during the dedup (see README). This test asserts the reconstruction matches
// what the published bot needs at runtime: stable slug, tier, capabilities, and
// a deterministic CAR derivation through @vorionsys/aurais-core.

test("MEETING_DISTILLER_IDENTITY shape is intact (reconstructed-from-dist sanity check)", () => {
  assert.equal(MEETING_DISTILLER_IDENTITY.slug, "aurais-meeting-distiller");
  assert.equal(MEETING_DISTILLER_IDENTITY.tier, 3);
  assert.equal(MEETING_DISTILLER_IDENTITY.maxEarnableTier, 4);
  assert.ok(Array.isArray(MEETING_DISTILLER_IDENTITY.capabilities));
  assert.ok(MEETING_DISTILLER_IDENTITY.capabilities.includes("tool:extract_decisions"));
  assert.ok(MEETING_DISTILLER_IDENTITY.capabilities.includes("tool:extract_action_items"));
  assert.ok(MEETING_DISTILLER_IDENTITY.capabilities.includes("data:write:none"));
});

test("deriveAgentIdentity returns a stable CAR id for this bot", () => {
  const a = deriveAgentIdentity(MEETING_DISTILLER_IDENTITY);
  const b = deriveAgentIdentity(MEETING_DISTILLER_IDENTITY);
  assert.ok(typeof a.carId === "string" && a.carId.length > 0, "carId is a non-empty string");
  assert.equal(a.carId, b.carId, "derivation is deterministic");
});
