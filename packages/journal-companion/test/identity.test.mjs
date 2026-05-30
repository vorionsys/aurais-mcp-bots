import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveAgentIdentity } from "@vorionsys/aurais-core";
import { JOURNAL_COMPANION_IDENTITY } from "../dist/identity.js";

test("JOURNAL_COMPANION_IDENTITY shape is intact", () => {
  assert.equal(JOURNAL_COMPANION_IDENTITY.slug, "aurais-journal-companion");
  assert.equal(JOURNAL_COMPANION_IDENTITY.tier, 3);
  assert.ok(Array.isArray(JOURNAL_COMPANION_IDENTITY.capabilities));
  assert.ok(JOURNAL_COMPANION_IDENTITY.capabilities.includes("safety:crisis-content-response"));
});

test("deriveAgentIdentity returns a stable CAR id for this bot", () => {
  const a = deriveAgentIdentity(JOURNAL_COMPANION_IDENTITY);
  const b = deriveAgentIdentity(JOURNAL_COMPANION_IDENTITY);
  assert.ok(typeof a.carId === "string" && a.carId.length > 0, "carId is a non-empty string");
  assert.equal(a.carId, b.carId, "derivation is deterministic");
});
