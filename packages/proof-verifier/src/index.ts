/**
 * Offline verifier for Aurais proof chains.
 *
 * A proof chain is the JSON array emitted by every @vorionsys/aurais-mcp-* bot
 * (the `proofChain` field of a tool result). Each event is:
 *
 *   { seq, ts, action, payload, prev_hash, pubkey, key_id, sig }
 *
 * where `sig` is an ed25519 signature over canonicalJSON of everything except
 * `sig` itself, and `prev_hash` is sha256(canonicalJSON(previous event)).
 *
 * This verifier independently re-derives both, using the SAME canonicalJSON +
 * sha256 from @vorionsys/aurais-core that produced the chain — so the digests
 * match byte-for-byte. It needs no network and no API key.
 *
 * What it CANNOT decide on its own: whether the signing key is the canonical
 * Aurais key. Keys whose `key_id` starts with `ed25519-ephemeral:` were
 * generated per-process (the BYOK default) and prove integrity, not identity.
 * That distinction is surfaced in the report as `ephemeralKey`.
 */
import { verify as cryptoVerify, createPublicKey } from "node:crypto";
import { canonicalJSON, sha256 } from "@vorionsys/aurais-core/canonical-json";

export interface ProofEvent {
  seq: number;
  ts: string;
  action: string;
  payload: unknown;
  prev_hash: string;
  pubkey: string;
  key_id: string;
  sig: string;
}

export interface EventReport {
  seq: number;
  action: string;
  signatureValid: boolean;
  linkValid: boolean;
  seqValid: boolean;
  keyConsistent: boolean;
  problems: string[];
}

export interface VerifyReport {
  ok: boolean;
  eventCount: number;
  keyId: string | null;
  ephemeralKey: boolean;
  tipHash: string;
  events: EventReport[];
  problems: string[];
}

const REQUIRED_FIELDS: (keyof ProofEvent)[] = [
  "seq",
  "ts",
  "action",
  "payload",
  "prev_hash",
  "pubkey",
  "key_id",
  "sig",
];

/** Reconstruct the exact object that was signed (every field except `sig`). */
function unsignedView(e: ProofEvent): Record<string, unknown> {
  return {
    seq: e.seq,
    ts: e.ts,
    action: e.action,
    payload: e.payload,
    prev_hash: e.prev_hash,
    pubkey: e.pubkey,
    key_id: e.key_id,
  };
}

function spkiFromBase64(pubB64: string) {
  return createPublicKey({
    key: Buffer.from(pubB64, "base64"),
    format: "der",
    type: "spki",
  });
}

/**
 * Verify a parsed proof-chain array. Pure: never throws on a malformed chain —
 * malformations are reported as problems with `ok: false`.
 */
export function verifyProofChain(chain: unknown): VerifyReport {
  const problems: string[] = [];
  const events: EventReport[] = [];

  if (!Array.isArray(chain)) {
    return {
      ok: false,
      eventCount: 0,
      keyId: null,
      ephemeralKey: false,
      tipHash: "",
      events: [],
      problems: ["input is not an array of proof events"],
    };
  }
  if (chain.length === 0) {
    return {
      ok: false,
      eventCount: 0,
      keyId: null,
      ephemeralKey: false,
      tipHash: "",
      events: [],
      problems: ["proof chain is empty"],
    };
  }

  let firstKeyId: string | null = null;
  let prevCanonical = "";

  chain.forEach((raw, i) => {
    const e = raw as ProofEvent;
    const evProblems: string[] = [];

    const missing = REQUIRED_FIELDS.filter((f) => e == null || e[f] === undefined);
    if (missing.length) {
      evProblems.push(`missing fields: ${missing.join(", ")}`);
      events.push({
        seq: typeof e?.seq === "number" ? e.seq : i,
        action: e?.action ?? "(unknown)",
        signatureValid: false,
        linkValid: false,
        seqValid: false,
        keyConsistent: false,
        problems: evProblems,
      });
      // Can't continue this event's crypto checks without its fields.
      return;
    }

    // 1. sequence is the array index
    const seqValid = e.seq === i;
    if (!seqValid) evProblems.push(`seq ${e.seq} != position ${i}`);

    // 2. hash link: prev_hash == sha256(canonical(previous event)), "" for first
    const expectedPrev = i === 0 ? "" : sha256(prevCanonical);
    const linkValid = e.prev_hash === expectedPrev;
    if (!linkValid) {
      evProblems.push(
        i === 0
          ? `first event prev_hash must be "" (got "${e.prev_hash}")`
          : `prev_hash does not match sha256 of event ${i - 1}`,
      );
    }

    // 3. signature: ed25519 over canonical(unsigned) with embedded pubkey
    let signatureValid = false;
    try {
      const toVerify = Buffer.from(canonicalJSON(unsignedView(e)));
      signatureValid = cryptoVerify(
        null,
        toVerify,
        spkiFromBase64(e.pubkey),
        Buffer.from(e.sig, "base64"),
      );
    } catch (err) {
      evProblems.push(`signature check errored: ${(err as Error).message}`);
    }
    if (!signatureValid && !evProblems.some((p) => p.startsWith("signature check errored"))) {
      evProblems.push("ed25519 signature invalid");
    }

    // 4. single consistent key across the whole chain
    if (firstKeyId === null) firstKeyId = e.key_id;
    const keyConsistent = e.key_id === firstKeyId;
    if (!keyConsistent) evProblems.push(`key_id changed mid-chain (${e.key_id} != ${firstKeyId})`);

    events.push({
      seq: e.seq,
      action: e.action,
      signatureValid,
      linkValid,
      seqValid,
      keyConsistent,
      problems: evProblems,
    });

    prevCanonical = canonicalJSON(e);
  });

  const ephemeralKey = (firstKeyId ?? "").startsWith("ed25519-ephemeral:");
  // tip = sha256(canonical(last event)); prevCanonical holds the last good one,
  // but recompute from the actual last element to be exact.
  const last = chain[chain.length - 1];
  const tipHash = last ? sha256(canonicalJSON(last)) : "";

  const allEventsOk = events.every(
    (e) => e.signatureValid && e.linkValid && e.seqValid && e.keyConsistent && e.problems.length === 0,
  );
  const ok = allEventsOk && events.length === chain.length;
  if (!ok && problems.length === 0) problems.push("one or more events failed verification");

  return {
    ok,
    eventCount: chain.length,
    keyId: firstKeyId,
    ephemeralKey,
    tipHash,
    events,
    problems,
  };
}

/** Convenience: parse a JSON string (full tool result or bare chain) and verify. */
export function verifyProofChainJSON(json: string): VerifyReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return {
      ok: false,
      eventCount: 0,
      keyId: null,
      ephemeralKey: false,
      tipHash: "",
      events: [],
      problems: [`input is not valid JSON: ${(e as Error).message}`],
    };
  }
  // Accept either a bare chain array or a full tool result { proofChain: [...] }.
  const chain =
    Array.isArray(parsed) || parsed == null
      ? parsed
      : (parsed as { proofChain?: unknown }).proofChain ?? parsed;
  return verifyProofChain(chain);
}
