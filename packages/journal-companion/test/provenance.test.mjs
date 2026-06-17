import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Stub the Anthropic SDK's Messages.create before driving the pipeline, so the
// test needs no API key and no network. We patch the resource prototype the
// lib's `new Anthropic().messages.create()` ultimately calls.
const require = createRequire(import.meta.url);
const messagesModPath = require.resolve("@anthropic-ai/sdk/resources/messages/messages.mjs");
const { Messages } = await import(messagesModPath);
Messages.prototype.create = async () => ({
  content: [
    {
      type: "text",
      text: JSON.stringify({
        moodScore: 1,
        moodLabel: "steady",
        themes: ["work"],
        gratitude: [],
        observationsOnPattern: "ok",
        gentleQuestion: "what next?",
      }),
    },
  ],
});

const { analyzeJournal } = await import("../dist/lib/analyzer.js");

test("session_started records package_version + upstream_proof for cross-bot provenance", async () => {
  const result = await analyzeJournal({
    entry: "Today was a long but productive day, and I shipped the thing.",
    anthropicApiKey: "sk-ant-stub",
    requestMeta: {
      clientHint: "test",
      upstreamProof: "UPSTREAM_TIP_abc123",
      packageVersion: "9.9.9",
    },
  });

  const started = result.proofChain.find(
    (e) => (e.action ?? e.event) === "session_started",
  );
  assert.ok(started, "chain has a session_started event");
  const payload = started.payload ?? started.data ?? started;

  assert.equal(payload.package_version, "9.9.9", "records the package version passed in");
  assert.equal(payload.upstream_proof, "UPSTREAM_TIP_abc123", "records the upstream proof tipHash");
  assert.ok(typeof result.tipHash === "string" && result.tipHash.length > 0, "produces a tipHash");
});

test("upstream_proof + package_version default to null when not supplied", async () => {
  const result = await analyzeJournal({
    entry: "A plain entry with no upstream provenance attached to it at all.",
    anthropicApiKey: "sk-ant-stub",
  });
  const started = result.proofChain.find(
    (e) => (e.action ?? e.event) === "session_started",
  );
  const payload = started.payload ?? started.data ?? started;
  assert.equal(payload.upstream_proof, null, "absent upstream proof is null, not undefined");
  assert.equal(payload.package_version, null, "absent package version is null, not undefined");
});
