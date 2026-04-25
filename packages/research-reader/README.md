# @vorionsys/aurais-mcp-research-reader

MCP server for the **Aurais Research Reader** bot. Paste a paper, article, or any text in your MCP client. Get thesis, claims with **verbatim-verified quotes**, counterpoints, and questions the source doesn't answer — all signed with a Vorion proof chain.

**Quote-verification guarantee**: every claim's `directQuote` is post-checked against the input text. Quotes that don't match verbatim are flagged in the output with a clear warning. The proof chain records `quotes_verbatim_verified` count so you can see at a glance if the model tried to hallucinate.

## Install in Claude Desktop

```json
{
  "mcpServers": {
    "aurais-research-reader": {
      "command": "npx",
      "args": ["-y", "@vorionsys/aurais-mcp-research-reader"],
      "env": { "ANTHROPIC_API_KEY": "sk-ant-your-key-here" }
    }
  }
}
```

## Tools

- `read_source(source, model?)` — structured reading with verbatim-verified quotes + signed proof chain.
- `get_agent_identity()` — CAR ID, tier, capabilities — no LLM call.

## Env

| Var | Required |
|---|---|
| `ANTHROPIC_API_KEY` | yes |
| `AURAIS_SIGNING_KEY_PRIV` | no (canonical signing key, base64 PKCS#8) |

## Architecture

This package depends on `@vorionsys/aurais-core` for the proof-chain (`ProofChain`, `hashText`, `EventAction`) and CAR identity (`deriveAgentIdentity`, `AgentIdentity`, `DeriveInput`). The per-bot identity constant `RESEARCH_READER_IDENTITY` lives here in `src/identity.ts`.

## License

Apache-2.0. See `../../LICENSE`.
