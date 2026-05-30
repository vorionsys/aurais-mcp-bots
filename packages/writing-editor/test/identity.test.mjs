import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveAgentIdentity } from "@vorionsys/aurais-core";
import { WRITING_EDITOR_IDENTITY } from "../dist/identity.js";

test("WRITING_EDITOR_IDENTITY shape is intact", () => {
  assert.equal(WRITING_EDITOR_IDENTITY.slug, "aurais-writing-editor");
  assert.equal(WRITING_EDITOR_IDENTITY.tier, 3);
  assert.ok(Array.isArray(WRITING_EDITOR_IDENTITY.capabilities));
  assert.ok(WRITING_EDITOR_IDENTITY.capabilities.includes("safety:never_rewrites_prose"));
});

test("deriveAgentIdentity returns a stable CAR id for this bot", () => {
  const a = deriveAgentIdentity(WRITING_EDITOR_IDENTITY);
  const b = deriveAgentIdentity(WRITING_EDITOR_IDENTITY);
  assert.ok(typeof a.carId === "string" && a.carId.length > 0, "carId is a non-empty string");
  assert.equal(a.carId, b.carId, "derivation is deterministic");
});
