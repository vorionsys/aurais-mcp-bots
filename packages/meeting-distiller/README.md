# @vorionsys/aurais-mcp-meeting-distiller

MCP server that exposes the **Aurais Meeting Distiller** bot to Claude Desktop, Claude Code, Cline, or any other MCP-compatible client.

Paste a meeting transcript → get back decisions, action items (with owners + due dates if named), follow-ups, open questions, risks, and participants mentioned. Every run produces a cryptographically signed Aurais proof chain with the bot's CAR identity.

## Install in Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "aurais-meeting-distiller": {
      "command": "npx",
      "args": ["-y", "@vorionsys/aurais-mcp-meeting-distiller"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-your-key-here"
      }
    }
  }
}
```

Restart Claude Desktop. Ask Claude to "distill this meeting" and paste a transcript.

## Install in Claude Code / other MCP clients

Same pattern — point at the `npx -y @vorionsys/aurais-mcp-meeting-distiller` command with `ANTHROPIC_API_KEY` in the env. See your client's MCP docs.

## Tools exposed

| Tool | What it does |
|---|---|
| `distill_meeting(transcript, model?)` | Runs the bot against the transcript. Returns structured output + the full signed proof chain. |
| `get_agent_identity()` | Returns this bot's CAR ID, tier, capabilities, deployment fingerprint. No LLM call. |

## Trust / governance features

- **CAR identity**: `car-aurais-meeting-distiller-<fingerprint>` — deterministic, derived from the signed manifest.
- **Ed25519-signed proof chain**: every step (session start, commentary generated, assembly) is an event, signed and chained via sha256 of the previous event.
- **Capability manifest**: the bot declares what it does (extract decisions, read transcripts transiently, call Anthropic, write nothing). Runtime enforces.
- **Verify any chain**: download the chain from the tool output, paste at [aurais.net/verify](https://www.aurais.net/verify).

## Environment variables

| Var | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Your Anthropic key. Starts with `sk-ant-`. |
| `AURAIS_SIGNING_KEY_PRIV` | no | Base64 PKCS#8 DER Ed25519 private key. If set and matching the published Aurais pubkey, chains are signed as `ed25519:a4bcca209898` (the canonical Aurais key). Otherwise a session-scoped ephemeral key is used. |
| `AURAIS_DEPLOYMENT_ID` | no | Override the auto-detected deployment ID embedded in the CAR identity. |

## Architecture

This package depends on `@vorionsys/aurais-core` for the proof-chain (`ProofChain`, `hashText`, `EventAction`) and CAR identity (`deriveAgentIdentity`, `AgentIdentity`, `DeriveInput`). The per-bot identity constant `MEETING_DISTILLER_IDENTITY` lives here in `src/identity.ts`.

> Note: the source-tree files for this package (`index.ts`, `lib/distiller.ts`, `lib/car-identity.ts`) were truncated in the local monorepo clone on branch `pre-split-capture-20260418` (a pre-existing condition unrelated to this dedup). The truncated tails were reconstructed from the package's compiled `dist/` (which was built before the corruption) and verified against the runtime call sites. The CAR identity module was replaced wholesale by the dedup; only the per-bot `MEETING_DISTILLER_IDENTITY` constant survives, recovered fully from `dist/lib/car-identity.js`.

## License + series

Apache-2.0. See `../../LICENSE`.

To own a numbered Series A serial of this bot (and receive a signed provenance certificate), see [aurais.net/pricing](https://www.aurais.net/pricing).

## Build locally

```bash
npm install
npm run build
npm start
```

MCP uses stdio — all logs go to stderr so they don't corrupt the protocol stream.
