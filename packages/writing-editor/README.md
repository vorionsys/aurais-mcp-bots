# @vorionsys/aurais-mcp-writing-editor

MCP server for the **Aurais Writing Editor** bot. **Critique-only — never rewrites your prose.** Paste a draft + audience + tone and get structural, sentence-level, and tone critique. Every issue cites a verbatim excerpt. Signed Vorion proof chain.

## Install in Claude Desktop

```json
{
  "mcpServers": {
    "aurais-writing-editor": {
      "command": "npx",
      "args": ["-y", "@vorionsys/aurais-mcp-writing-editor"],
      "env": { "ANTHROPIC_API_KEY": "sk-ant-your-key-here" }
    }
  }
}
```

## Tools

- `critique_draft(draft, audience, tone, model?)` — structural + sentence-level + tone critique + strengths + signed proof chain.
- `get_agent_identity()` — CAR ID, tier, capabilities.

## Why critique-only

An LLM that rewrites your prose launders your voice into its voice. This bot points out problems — pacing, clarity, tone drift — and leaves the editing to you. Your authorship stays yours, and every suggestion is auditable because it cites verbatim excerpts.

## Architecture

This package depends on `@vorionsys/aurais-core` for the proof-chain (`ProofChain`, `hashText`, `EventAction`) and CAR identity (`deriveAgentIdentity`, `AgentIdentity`, `DeriveInput`). The per-bot identity constant `WRITING_EDITOR_IDENTITY` lives here in `src/identity.ts`.

## License

Apache-2.0. See `../../LICENSE`.
