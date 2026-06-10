# @vorionsys/aurais-verify

Offline verifier for **Aurais proof chains** — the signed, hash-chained event
logs emitted by every [`@vorionsys/aurais-mcp-*`](https://github.com/voriongit/aurais-mcp-bots)
bot. No network, no API key: it checks the cryptography that's already in the
chain.

## Use it

```bash
# one-off, no install
npx @vorionsys/aurais-verify chain.json

# from stdin / a pipe
npx @vorionsys/aurais-verify < chain.json
some-aurais-bot | npx @vorionsys/aurais-verify

# machine-readable report (exit code still reflects pass/fail)
npx @vorionsys/aurais-verify --json chain.json
```

Input may be a bare proof-chain array **or** a full tool result object with a
`proofChain` field — the verifier finds the chain either way. Exit code is
`0` when verified, `1` when it fails or the input is malformed (CI-friendly).

## What it checks

For every event in the chain:

| Check | Meaning |
|-------|---------|
| **sig**  | ed25519 signature is valid over the event's canonical JSON, using the public key embedded in the event |
| **link** | `prev_hash` equals `sha256(canonicalJSON(previous event))` — events can't be reordered or inserted |
| **seq**  | sequence number matches position — no events dropped from the middle |
| **key**  | the same signing key is used across the whole chain — no mid-chain key swap |

It also recomputes the **tip hash** (commits to the full length, so truncation
is detectable) and reuses the *exact* `canonicalJSON` + `sha256` from
`@vorionsys/aurais-core` that produced the chain, so digests match
byte-for-byte.

## What it deliberately does **not** claim

Verification proves **integrity** — the chain wasn't altered after signing. It
does **not**, on its own, prove **identity** — that the signer is the canonical
Aurais key. Chains signed with a session-scoped key (the BYOK default) carry a
`key_id` beginning `ed25519-ephemeral:`; the verifier flags these explicitly.
To establish identity, confirm the chain's `key_id` / public key against a key
you trust out of band.

## Library API

```ts
import { verifyProofChain, verifyProofChainJSON } from "@vorionsys/aurais-verify";

const report = verifyProofChain(parsedChainArray);
// report.ok, report.events[], report.tipHash, report.keyId, report.ephemeralKey
```

Both functions are pure and never throw on bad input — malformations come back
as `{ ok: false, problems: [...] }`.

## License

Apache-2.0 — © Vorion LLC
