# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository.

## What this is

An npm-workspaces monorepo that publishes **six** `@vorionsys` packages in
lock-step:

- **Five Aurais MCP servers ("bots")** — `packages/journal-companion`,
  `market-scout`, `meeting-distiller`, `research-reader`, `writing-editor`.
  Each is a standalone Model Context Protocol server (stdio by default) that
  calls Claude and emits a **signed Aurais proof chain** for every run.
- **One verifier** — `packages/proof-verifier` → `@vorionsys/aurais-verify`, a
  no-network CLI that checks proof chains offline (Ed25519 signatures, hash
  links, sequence, key consistency).

All six depend on the published **`@vorionsys/aurais-core`** (`^0.1.0`) for the
trust primitives: `ProofChain`, `deriveAgentIdentity`, `canonicalJSON`,
`sha256`.

## Layout

```
packages/
  journal-companion/  market-scout/  meeting-distiller/
  research-reader/    writing-editor/        # the 5 bots
  proof-verifier/                            # @vorionsys/aurais-verify
```

Per package: `src/` (TypeScript) → `dist/` (built, **gitignored**),
`test/*.test.mjs` (`node:test`).

## Commands

```bash
npm ci                                         # install
npm run typecheck --workspaces --if-present    # tsc --noEmit
npm run build     --workspaces --if-present    # tsc -> dist/
npm test          --workspaces --if-present    # node:test
```

Run a bot over stdio (needs an API key):

```bash
ANTHROPIC_API_KEY=… node packages/<bot>/dist/index.js
```

## Conventions

- **Lock-step versioning** — all six packages share one version; bump together.
- **Releases** — tag-triggered OIDC trusted publishing (no tokens) plus an
  auto-created GitHub Release. See [`RELEASING.md`](RELEASING.md).
- **Transports** — stdio is the default. `AURAIS_TRANSPORT=http` enables a
  remote HTTP transport with a per-request `X-Anthropic-Key`; an opt-in
  OAuth 2.1 resource-server mode is available over HTTP. Both unset → no auth,
  stdio.
- **Provenance** — every proof chain records `package_version`, read at runtime
  from the package's own `package.json` (never hardcoded).
- **Branching** — develop on a feature branch, PR into `main`; the
  `build-and-test` CI check runs on PRs.

## Current state (snapshot: 2026-06)

All six packages published at **0.4.0** on npm with OIDC provenance.
