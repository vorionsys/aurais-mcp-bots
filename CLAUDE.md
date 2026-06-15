# CLAUDE.md — aurais-mcp-bots

Developer reference for AI agents and humans working in this repo.

## Repo overview

Five Aurais MCP servers in an npm workspaces monorepo. Each package is a standalone
Model Context Protocol server. All five share `@vorionsys/aurais-core` (published on npm)
for proof-chain signing, CAR identity derivation, and hashing helpers.

```
packages/
  journal-companion/    @vorionsys/aurais-mcp-journal-companion   tool: reflect_on_entry
  market-scout/         @vorionsys/aurais-mcp-market-scout        tool: brief_tickers
  meeting-distiller/    @vorionsys/aurais-mcp-meeting-distiller   tool: distill_meeting
  research-reader/      @vorionsys/aurais-mcp-research-reader     tool: read_source
  writing-editor/       @vorionsys/aurais-mcp-writing-editor      tool: critique_draft
```

All five also expose `get_agent_identity` (no API call — returns CAR ID + deployment fingerprint).

## Inside each package

```
src/
  index.ts        MCP server wiring (tool definitions, stdio transport)
  identity.ts     The bot's *_IDENTITY constant (slug, version, capabilities)
  lib/<name>.ts   Domain logic (analyzer / distiller / briefing / etc.)
test/
  *.test.mjs      Node built-in test runner
```

## Development commands

```bash
npm install                              # install all workspaces
npm run typecheck --workspaces --if-present
npm run build --workspaces --if-present  # tsc → dist/ in each package
npm test --workspaces --if-present
```

Per-package dev server (stdio MCP):

```bash
cd packages/journal-companion
npm run dev   # tsx src/index.ts
```

## CI

`.github/workflows/ci.yml` — runs on push to `main` and every PR:

1. `npm ci`
2. `npm run typecheck --workspaces --if-present`
3. `npm run build --workspaces --if-present`
4. `npm test --workspaces --if-present`

`actions/checkout@v5` runs with `persist-credentials: false` to avoid a duplicate
Authorization header that caused HTTP 400 on earlier npm installs.

## Releasing

**`.github/workflows/release.yml`** — tag-triggered. Push a `v*` tag and all five packages
publish to npm with SLSA provenance attestations.

```bash
# bump versions in all five package.json files, commit, then:
git tag v0.4.0
git push origin v0.4.0
```

Required secrets (repo → Settings → Secrets → Actions):
- `NPM_TOKEN` — @vorionsys-scoped automation token with publish rights.

`GH_TOKEN` is **no longer needed** — `@vorionsys/aurais-core` is on npm, not a git URL.

The publish step is idempotent: it skips any workspace whose current version is
already on npm, so re-running a tag workflow after a partial failure is safe.

## Shared dependency: @vorionsys/aurais-core

Source: `voriongit/aurais-core`  
Published: `@vorionsys/aurais-core@0.1.0` on npm (public, no token needed)

Key exports: `ProofChain`, `deriveAgentIdentity`, `canonicalJSON`, `sha256`.

To upgrade core: bump the `^0.1.0` range in all five `package.json` files, update
`package-lock.json` via `npm install`, and cut a new release tag.

## Pending: Step 3 consolidation

This repo is **step 2 of 3** in the aurais-mcp consolidation:
- Step 1: extracted `@vorionsys/aurais-core` → `voriongit/aurais-core` ✓
- Step 2: published all five MCP bots to npm at v0.3.0 ✓
- Step 3: retire the duplicate copies of the MCP bots inside `voriongit/aurais`
  (the Next.js app) and point it at the npm packages instead. **NOT YET DONE.**

## Architecture note

Proof chain flow per bot run:

```
session_started → commentary_generated → briefing_assembled
```

Each event is Ed25519-signed and sha256-chained to the previous. The final
`proofChain` array in every bot's JSON output can be verified offline or at
`https://www.aurais.net/verify`.
