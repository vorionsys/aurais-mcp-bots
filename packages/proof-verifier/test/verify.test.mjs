import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { ProofChain } from "@vorionsys/aurais-core";
import { canonicalJSON, sha256 } from "@vorionsys/aurais-core/canonical-json";
import { verifyProofChain, verifyProofChainJSON } from "../dist/index.js";

// Build a real signed chain the same way the bots do.
function sampleChain() {
  const chain = new ProofChain();
  chain.append("session_started", { bot: "test", n: 1 });
  chain.append("commentary_generated", { provider: "anthropic", ok: true });
  chain.append("briefing_assembled", { count: 3 });
  return chain.toJSON();
}

test("a genuine chain verifies clean", () => {
  const r = verifyProofChain(sampleChain());
  assert.equal(r.ok, true, r.problems.join("; "));
  assert.equal(r.eventCount, 3);
  assert.ok(r.events.every((e) => e.signatureValid && e.linkValid && e.seqValid && e.keyConsistent));
  assert.ok(r.tipHash.length > 0);
});

test("ephemeral session keys are flagged (integrity, not identity)", () => {
  // No AURAIS_SIGNING_KEY_PRIV in the test env → ephemeral key id.
  const r = verifyProofChain(sampleChain());
  assert.equal(r.ephemeralKey, true, "session-scoped key should be flagged ephemeral");
  assert.ok(r.keyId?.startsWith("ed25519-ephemeral:"));
});

test("tampering with a payload breaks that event's signature", () => {
  const c = sampleChain();
  c[1] = { ...c[1], payload: { provider: "anthropic", ok: false } }; // flip a value
  const r = verifyProofChain(c);
  assert.equal(r.ok, false);
  assert.equal(r.events[1].signatureValid, false, "mutated payload must fail signature");
});

test("reordering / breaking the hash link is detected", () => {
  const c = sampleChain();
  // swap events 1 and 2 — their prev_hash links no longer hold
  [c[1], c[2]] = [c[2], c[1]];
  const r = verifyProofChain(c);
  assert.equal(r.ok, false);
  assert.ok(r.events.some((e) => !e.linkValid || !e.seqValid), "broken order must be caught");
});

test("truncating the chain still verifies the remaining prefix but changes the tip", () => {
  const full = sampleChain();
  const prefix = full.slice(0, 2);
  const rFull = verifyProofChain(full);
  const rPrefix = verifyProofChain(prefix);
  assert.equal(rPrefix.ok, true, "a valid prefix is itself a valid chain");
  assert.notEqual(rFull.tipHash, rPrefix.tipHash, "tip commits to the full length");
});

test("an event signed by a different key (key_id changes mid-chain) is rejected", () => {
  // Forge a replacement event signed by a *different* ed25519 key, mimicking an
  // attacker who re-signs tampered content with their own key. (Within one
  // process ProofChain caches one keypair, so we mint a second key by hand.)
  const c = sampleChain();
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pubB64 = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const forgedKeyId = "ed25519:" + sha256(pubB64).slice(0, 12);

  const unsigned = {
    seq: 2,
    ts: new Date().toISOString(),
    action: "briefing_assembled",
    payload: { count: 999 },
    prev_hash: sha256(canonicalJSON(c[1])), // correct link, so only the KEY is the tell
    pubkey: pubB64,
    key_id: forgedKeyId,
  };
  const sig = sign(null, Buffer.from(canonicalJSON(unsigned)), privateKey).toString("base64");
  c[2] = { ...unsigned, sig };

  const r = verifyProofChain(c);
  // The forged event's own signature is internally valid, but the key changed
  // mid-chain — that's the violation a verifier must catch.
  assert.equal(r.ok, false, "a key change mid-chain must fail the chain");
  assert.equal(r.events[2].keyConsistent, false, "key inconsistency is flagged on the forged event");
  assert.equal(r.events[2].signatureValid, true, "forged event is self-consistently signed (key is the only tell)");
});

test("non-array / empty / malformed inputs fail gracefully (no throw)", () => {
  assert.equal(verifyProofChain(null).ok, false);
  assert.equal(verifyProofChain([]).ok, false);
  assert.equal(verifyProofChainJSON("not json").ok, false);
  assert.equal(verifyProofChainJSON("{}").ok, false);
});

test("accepts a full tool-result object with a proofChain field", () => {
  const wrapped = JSON.stringify({ generatedAt: "now", proofChain: sampleChain(), tipHash: "x" });
  const r = verifyProofChainJSON(wrapped);
  assert.equal(r.ok, true, r.problems.join("; "));
  assert.equal(r.eventCount, 3);
});
