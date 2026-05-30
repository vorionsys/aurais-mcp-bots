import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveAgentIdentity } from "@vorionsys/aurais-core";
import { MARKET_SCOUT_IDENTITY } from "../dist/identity.js";

test("MARKET_SCOUT_IDENTITY shape is intact", () => {
  assert.equal(MARKET_SCOUT_IDENTITY.slug, "aurais-market-scout");
  assert.equal(MARKET_SCOUT_IDENTITY.tier, 3);
  assert.ok(Array.isArray(MARKET_SCOUT_IDENTITY.capabilities));
  assert.ok(MARKET_SCOUT_IDENTITY.capabilities.includes("api:get:finance.yahoo.com"));
});

test("deriveAgentIdentity returns a stable CAR id for this bot", () => {
  const a = deriveAgentIdentity(MARKET_SCOUT_IDENTITY);
  const b = deriveAgentIdentity(MARKET_SCOUT_IDENTITY);
  assert.ok(typeof a.carId === "string" && a.carId.length > 0, "carId is a non-empty string");
  assert.equal(a.carId, b.carId, "derivation is deterministic");
});
