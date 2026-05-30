import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveAgentIdentity } from "@vorionsys/aurais-core";
import { RESEARCH_READER_IDENTITY } from "../dist/identity.js";

test("RESEARCH_READER_IDENTITY shape is intact", () => {
  assert.equal(RESEARCH_READER_IDENTITY.slug, "aurais-research-reader");
  assert.equal(RESEARCH_READER_IDENTITY.tier, 3);
  assert.ok(Array.isArray(RESEARCH_READER_IDENTITY.capabilities));
  assert.ok(RESEARCH_READER_IDENTITY.capabilities.includes("tool:verify_quotes_verbatim"));
});

test("deriveAgentIdentity returns a stable CAR id for this bot", () => {
  const a = deriveAgentIdentity(RESEARCH_READER_IDENTITY);
  const b = deriveAgentIdentity(RESEARCH_READER_IDENTITY);
  assert.ok(typeof a.carId === "string" && a.carId.length > 0, "carId is a non-empty string");
  assert.equal(a.carId, b.carId, "derivation is deterministic");
});
