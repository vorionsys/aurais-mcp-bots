# aurais-mcp-bots

Five Aurais MCP servers plus an offline proof-chain verifier — one monorepo, one shared core. Each bot is a standalone Model Context Protocol server you can drop into Claude Desktop, Claude Code, or any MCP client. Every run produces a signed Aurais proof chain you can verify offline (see [Verify a proof chain](#verify-a-proof-chain)).

## The bots

| Package directory | npm name | Tool | Capability |
|-------------------|----------|------|------------|
| `packages/journal-companion` | `@vorionsys/aurais-mcp-journal-companion` | `reflect_on_entry` | Paste a journal entry, get a structured reflection (mood, themes, gratitude, one gentle question). Crisis-aware. |
| `packages/market-scout` | `@vorionsys/aurais-mcp-market-scout` | `brief_tickers` | Tickers in, per-ticker briefings out (RSI, MACD, SMA, volume, relative strength vs SPY). |
| `packages/meeting-distiller` | `@vorionsys/aurais-mcp-meeting-distiller` | `distill_meeting` | Paste a transcript, get decisions + action items (with owner / due) + follow-ups + open questions + risks. |
| `packages/research-reader` | `@vorionsys/aurais-mcp-research-reader` | `read_source` | Paste a paper or article, get a structured read with verbatim-verified quotes. |
| `packages/writing-editor` | `@vorionsys/aurais-mcp-writing-editor` | `critique_draft` | Paste a draft + audience + tone, get structural / sentence-level / tone critique. Never rewrites your prose. |

Every bot also exposes `get_agent_identity` — returns the bot's CAR ID, tier, capabilities, and deployment fingerprint with no API call.

## Chaining bots (cross-bot provenance)

Each tool accepts an optional `upstreamProof` argument: the `tipHash` from a
prior Aurais bot run. When supplied, it's recorded in this run's
`session_started` event, so a verifier can trace one bot's output back to the
upstream run that fed it — a provenance graph across bots, not just within one.

```
research-reader.read_source(paper)        → tipHash A
writing-editor.critique_draft(            → tipHash B, whose chain records
  draft, upstreamProof: A)                  upstream_proof = A
```

Every `session_started` event also records `package_version` (the running
package's real version, read from its `package.json` — not a hardcode), so a
chain attests exactly which published build produced it.

## Architecture

All five bots share `@vorionsys/aurais-core` for the load-bearing trust primitives:

- **`ProofChain`** — Ed25519-signed, sha256-chained event log. Every bot run emits `session_started` → `commentary_generated` → `briefing_assembled` events.
- **`deriveAgentIdentity`** — deterministic offline CAR ID derivation from `(slug, version, manifest_hash)`. Returns tier, ceiling, capabilities, deployment fingerprint.
- **`canonicalJSON`** + **`sha256`** — deterministic serialization + hashing helpers (re-exported so callers produce digests that match what the lib produces).

What each bot keeps for itself:

- **`identity.ts`** — the bot's `*_IDENTITY` constant (slug, version, name, tier, capabilities). Fed to `deriveAgentIdentity` from `@vorionsys/aurais-core` at run time.
- **`lib/<domain>.ts`** — the bot's domain logic (analyzer / distiller / briefing / etc).
- **`index.ts`** — the MCP server wiring (tool definitions, transport).

This was **step 2 of 3** in the aurais-mcp consolidation — all three steps are now complete. Step 1 extracted [`@vorionsys/aurais-core`](https://www.npmjs.com/package/@vorionsys/aurais-core) (canonical repo `vorionsys/aurais-core`, published to npm); step 2 (this repo) deduped the bots onto it and published all packages; step 3 retired the duplicate copies inside the Aurais Next.js app, which now depends on `@vorionsys/aurais-core` directly.

## Provenance

Source: the private `voriongit/vorion` monorepo (not publicly accessible), working tree on branch `pre-split-capture-20260418` at HEAD `94a6de87720b2280d59e36442370078275bdc959` on 2026-04-25.

Each package was extracted from `vorion/packages/aurais-mcp-<name>/`. Per-bot source files (`index.ts`, `lib/<domain>.ts`, `identity.ts`) were preserved unchanged — only the duplicated `proof-chain.ts`, `car-identity.ts`, and inlined `canonicalJSON` were removed and replaced with imports from `@vorionsys/aurais-core`.

> Note on `meeting-distiller`: the source-tree copies of `index.ts`, `lib/distiller.ts`, and `lib/car-identity.ts` were truncated mid-file in the local clone (a known pre-existing condition on the `pre-split-capture-20260418` branch). The truncated tails were reconstructed from the package's compiled `dist/` (which was built before the corruption) and verified against the runtime call sites in `index.ts`. The CAR identity module was replaced wholesale by the dedup, so its truncation only affected the per-bot `MEETING_DISTILLER_IDENTITY` constant — recovered fully from `dist/lib/car-identity.js`.

## Develop

```bash
npm install
npm run typecheck   # all workspaces
npm run build       # all workspaces (tsc → dist/)
npm test            # all workspaces (skips if no test script)
```

Per-bot dev:

```bash
cd packages/journal-companion
npm run dev   # tsx src/index.ts — runs the MCP server on stdio
```

## Run as an MCP server

After building, register a bot in your MCP client. Example for Claude Desktop / Claude Code (`~/.config/claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "aurais-meeting-distiller": {
      "command": "npx",
      "args": ["-y", "@vorionsys/aurais-mcp-meeting-distiller"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "AURAIS_SIGNING_KEY_PRIV": "<optional base64 PKCS8 to co-sign with the canonical Aurais key>"
      }
    }
  }
}
```

(Replace `meeting-distiller` with any of the other four bot names. Each is published as `@vorionsys/aurais-mcp-<name>`.)

### Remote (HTTP) mode

The same binary also runs as a **remote** MCP server over Streamable HTTP — set
`AURAIS_TRANSPORT=http` (default is stdio, unchanged). In HTTP mode the caller
supplies their **own** Anthropic key per request via the `X-Anthropic-Key`
header, so no long-lived key lives on the server:

```bash
AURAIS_TRANSPORT=http PORT=3000 npx -y @vorionsys/aurais-mcp-meeting-distiller
# MCP endpoint: POST http://<host>:3000/mcp
#   header: X-Anthropic-Key: sk-ant-...
```

| | stdio (default) | http (`AURAIS_TRANSPORT=http`) |
|---|---|---|
| Audience | local (Claude Desktop/Code) | remote connector / shared server |
| API key | `ANTHROPIC_API_KEY` env | `X-Anthropic-Key` request header |
| Session | per process | stateless (no session id) |

> **Serve HTTP behind TLS.** The key is sent on every request, so terminate
> HTTPS at a proxy (or in front of the container) before exposing it. The
> built-in server speaks plain HTTP and is meant to sit behind that boundary.

### OAuth 2.1 (spec-standard auth for remote servers)

In HTTP mode each bot can additionally act as an **OAuth 2.1 resource server**
per the [MCP authorization spec (2025-06-18)](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization).
Enable it by pointing the bot at your authorization server and declaring its
own canonical URL:

```bash
AURAIS_TRANSPORT=http PORT=3000 \
AURAIS_OAUTH_ISSUER=https://auth.example.com \
AURAIS_OAUTH_RESOURCE=https://bots.example.com/mcp \
npx -y @vorionsys/aurais-mcp-meeting-distiller
```

When enabled, every MCP request must carry `Authorization: Bearer <jwt>` and
the bot enforces the spec's MUSTs:

- **Signature** — verified against the issuer's JWKS (discovered via RFC 8414 /
  OIDC metadata, cached, rotation-aware).
- **Audience binding (RFC 8707)** — `aud` must equal `AURAIS_OAUTH_RESOURCE`;
  tokens minted for any other service are rejected. Inbound tokens are never
  forwarded upstream (token passthrough is forbidden by spec).
- **Issuer + expiry** — `iss` must match, `exp` is enforced (5 s clock tolerance).
- **Discovery** — RFC 9728 protected-resource metadata is served at
  `/.well-known/oauth-protected-resource` (and the path-appended form), and
  401 responses carry `WWW-Authenticate: Bearer … resource_metadata="…"` so
  MCP clients can find your authorization server automatically.

OAuth **authenticates the caller**; it does not replace BYOK — the
`X-Anthropic-Key` header still supplies the caller's own Anthropic key. Any
OAuth 2.1 / OIDC provider that signs JWT access tokens and serves a JWKS works
as the authorization server (Auth0, Keycloak, WorkOS, etc.). Both env vars
unset → no auth required, exactly as before.

## `@vorionsys/aurais-core` dependency

All six packages — the five bots and the verifier — consume the shared core from npm via a semver range:

```json
"@vorionsys/aurais-core": "^0.1.0"
```

`@vorionsys/aurais-core@0.1.0` is published publicly on npm, so `npm install`, CI, and `npx -y @vorionsys/aurais-mcp-<name>` all resolve it with no token or SSH key. (Earlier pre-publish revisions of this repo pinned the dep to a GitHub URL and required a `GH_TOKEN` secret in CI — that's no longer needed.)

## Verify a proof chain

Run any bot, capture the JSON output, and verify it offline with the bundled
verifier — no network, no API key:

```bash
# verify a saved result (bare chain or full tool-result JSON both work)
npx @vorionsys/aurais-verify result.json

# or pipe a bot's output straight in
some-aurais-bot | npx @vorionsys/aurais-verify
```

It checks every event's **ed25519 signature**, the **hash links** between
events, **sequence** integrity, and **key consistency**, then recomputes the
tip. Exit code `0` = verified, `1` = failed. See
[`packages/proof-verifier`](packages/proof-verifier) for the full check list,
the library API (`verifyProofChain`), and the important distinction between
integrity (what it proves) and signer identity (what it can't, for
session-scoped keys).

Prefer a library? `@vorionsys/aurais-core` exports the same `canonicalJSON` +
`sha256` primitives the chain is built from. A web verifier also runs at
`https://www.aurais.net/verify`.

## License

Apache-2.0. See `LICENSE`.
