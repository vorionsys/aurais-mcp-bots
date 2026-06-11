# Contributing & Multi-Agent Coordination

This repo is an npm monorepo (the `@vorionsys/aurais-mcp-*` workspaces). Work — by humans or LLM agents — often happens in parallel. These rules keep concurrent edits from turning into duplicate, competing, or conflicting work.

## Branch & PR flow

- Never commit directly to `main`. All changes land via a pull request.
- One branch per task. Keep branches short-lived: small scope, merge fast, then start fresh from an updated `main`.
- Open a PR early (draft is fine). The PR is the coordination surface everyone can see.
- Before merging, click **Update branch** (or `git fetch && git merge origin/main`) so conflicts surface early, not at merge time.
- CI must be green before merge. The `CI` workflow (typecheck + build + test across all workspaces) is the gate.

## Multi-agent rules (prevent duplicate / competing work)

1. **One agent, one workspace.** Assign each agent a distinct package directory so file footprints don't overlap. Non-overlapping changes merge cleanly and cannot conflict.
2. **Claim work via an Issue.** Before starting, open or get assigned a GitHub Issue describing the task. An assigned issue is a visible "I'm working on this" flag — check it before starting to avoid duplicating.
3. **Serialize shared-file changes.** Version bumps, `package-lock.json`, shared config, and `.github/workflows/*` must be done one at a time — never by parallel agents. These files conflict constantly.
4. **Small PRs over big ones.** A branch touching 3 files for an hour rarely conflicts. A branch touching 20 files for 3 days is a conflict magnet.
5. **Resync before continuing.** After any PR merges to `main`, other in-flight branches should pull `main` in before doing more work.

## CI/CD

- **CI** (`ci.yml`) runs on every PR and every push to `main`: `npm ci`, then typecheck → build → test across all workspaces. This is the merge gate.
- **Release** (`release.yml`) runs only when a `v*` tag is pushed. It rebuilds, retests, and publishes all `@vorionsys/aurais-mcp-*` packages to npm via OIDC trusted publishing (no stored token) with `--provenance`.

### Release sequence

1. Merge the version-bump PR (e.g. `chore(release): vX.Y.Z`) to `main`. **Merging does not publish.**
2. Push the `vX.Y.Z` tag → the Release pipeline publishes all packages at that version.
3. A brand-new package cannot be created by OIDC on its first publish — it must be bootstrapped once manually (`npm login` + configure its trusted publisher on npmjs.com) before it can be included in a tagged release.
