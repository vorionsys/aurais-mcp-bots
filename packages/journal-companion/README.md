# @vorionsys/aurais-mcp-journal-companion

MCP server for the **Aurais Journal Companion** bot. Paste a journal entry in Claude Desktop / Claude Code / any MCP client, get a gentle structured reflection back + a cryptographically signed Vorion proof chain.

Built-in crisis safety: entries mentioning self-harm / suicidal content trigger a hard-coded safety response with crisis-line contacts (988 / 111 / findahelpline.com). No analysis performed in that path.

## Install in Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "aurais-journal-companion": {
      "command": "npx",
      "args": ["-y", "@vorionsys/aurais-mcp-journal-companion"],
      "env": { "ANTHROPIC_API_KEY": "sk-ant-your-key-here" }
    }
  }
}
```

## Tools

- `reflect_on_entry(entry, model?)` — mood score, themes, gratitude, observations, one question. Signed proof chain included.
- `get_agent_identity()` — CAR ID, tier, capabilities — no LLM call.

## Env

| Var | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Your Anthropic key |
| `AURAIS_SIGNING_KEY_PRIV` | no | Base64 PKCS#8 DER Ed25519 private key — signs chains with the canonical Aurais key if matching |

## Architecture

This package depends on `@vorionsys/aurais-core` for the proof-chain (`ProofChain`, `hashText`, `hashJSON`, `EventAction`) and CAR identity (`deriveAgentIdentity`, `AgentIdentity`, `DeriveInput`). The per-bot identity constant `JOURNAL_COMPANION_IDENTITY` lives here in `src/identity.ts`.

## Important

Aurais Journal Companion is a reflection tool, not a clinician. For mental-health support: 988 in the US/Canada, 111 in the UK, findahelpline.com elsewhere.

## License

Apache-2.0. See `../../LICENSE`.
