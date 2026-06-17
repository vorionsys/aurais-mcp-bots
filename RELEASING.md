# Releasing

This repo publishes **six** packages in **lock-step** from a single git tag.

| Package | Role |
|---|---|
| `@vorionsys/aurais-mcp-journal-companion` | MCP server (bot) |
| `@vorionsys/aurais-mcp-market-scout` | MCP server (bot) |
| `@vorionsys/aurais-mcp-meeting-distiller` | MCP server (bot) |
| `@vorionsys/aurais-mcp-research-reader` | MCP server (bot) |
| `@vorionsys/aurais-mcp-writing-editor` | MCP server (bot) |
| `@vorionsys/aurais-verify` | Offline proof-chain verifier (CLI) |

All six always carry the **same version**. The version recorded in every proof
chain (`package_version`) is read at runtime from each package's own
`package.json`, so bumping the version automatically attests the new build.

## How a release happens

Pushing a tag matching `v*` triggers [`.github/workflows/release.yml`](.github/workflows/release.yml), which:

1. Sets up Node 22 and **upgrades npm to ≥ 11.5.1** — Node 22 ships npm 10.x,
   which silently ignores OIDC and would fall back to a token.
2. `npm ci` → typecheck → build → test (all workspaces).
3. `npm publish --workspaces --access=public --provenance` — publishes all six
   via **OIDC trusted publishing**: no token, no secret, provenance attested.
4. A separate `github-release` job creates a **GitHub Release** for the tag with
   auto-generated notes (idempotent — skips if the release already exists).

### One-time prerequisites (already done for the 0.x line)

- Each package has a **trusted publisher** at
  `npmjs.com/package/<name>/access → Trusted Publisher → GitHub Actions`:
  - Organization/user: `voriongit`
  - Repository: `aurais-mcp-bots`
  - Workflow filename: `release.yml` (filename only, not the path)
  - Environment: *(blank)*
- `NPM_TOKEN` has been retired — there are no publish secrets.

## Cutting a release

1. **Bump all six** `packages/*/package.json` to the new `X.Y.Z`, then
   `npm install` to sync `package-lock.json`.
2. Run the gate locally:
   `npm run typecheck --workspaces && npm run build --workspaces && npm test --workspaces`.
3. Open a PR with the bump, get CI green, merge to `main`.
4. **Tag `main` and push the tag** — this is what publishes:
   ```bash
   git checkout main && git pull
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```
5. Watch the **Release** workflow: all six land on npm and a GitHub Release is
   created.
6. Verify, e.g. `npm view @vorionsys/aurais-verify version`.

## Adding / bootstrapping a NEW package

npm OIDC trusted publishing **cannot create a brand-new package** on its first
publish. A package that has never been on npm needs a one-time manual bootstrap:

1. Build it first — `dist/` is gitignored and there is no publish-time build:
   `npm run build --workspace=@vorionsys/<name>`
2. Bootstrap-publish from an **authenticated** account, at a version **below**
   the next lock-step release so the tagged publish won't collide:
   ```bash
   npm login
   # if main is already ahead, stamp a lower version just for the bootstrap:
   npm pkg set version=<lower> --workspace=@vorionsys/<name>
   npm publish --workspace=@vorionsys/<name> --access=public   # --access=public required for scoped pkgs
   ```
3. Configure its **trusted publisher** on npmjs.com (same values as above).
4. From then on it rides the tagged OIDC pipeline like the rest.

> History: `@vorionsys/aurais-verify` was bootstrapped at `0.3.1` this way, then
> shipped at `0.4.0` through the pipeline.

## Gotchas (learned the hard way)

- **`npm publish --workspaces` is all-or-nothing per version.** If any package's
  target version already exists on npm, the whole step fails. Never manually
  pre-publish a version that the tag will also publish.
- **Tags must be pushed from a machine with push rights.** The Claude-Code-on-the-web
  / managed environment can push branches but **not tags** (403) — push release
  tags from a local clone.
- **PowerShell**: `&&` is not a valid statement separator — run each command on
  its own line.
- **`dist/` is gitignored** — always build before any manual publish.
