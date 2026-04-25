# @vorionsys/aurais-mcp-market-scout

MCP server for the **Aurais Market Scout** bot. Pass up to 10 ticker symbols from your MCP client. Get per-ticker briefings with RSI, MACD, SMA20/50, volume ratio, relative strength vs SPY, and Claude-generated commentary that cites numbers and flags one risk. Every run ships with a signed Vorion proof chain.

**Not investment advice.** Publisher/tool framing — no personalized recommendations, no execution, no brokerage integration.

## Install in Claude Desktop

```json
{
  "mcpServers": {
    "aurais-market-scout": {
      "command": "npx",
      "args": ["-y", "@vorionsys/aurais-mcp-market-scout"],
      "env": { "ANTHROPIC_API_KEY": "sk-ant-your-key-here" }
    }
  }
}
```

## Tools

- `brief_tickers(tickers, model?)` — run the briefing on 1-10 symbols. Returns a formatted briefing + full JSON result including the signed proof chain.
- `get_agent_identity()` — CAR ID, tier, capabilities — no LLM call, no network.

## Data source

Market data from Yahoo Finance's public chart endpoint (no key required). Stocks, ETFs, and common crypto pairs (`BTC-USD`, `ETH-USD`, etc.) supported.

## Env

| Var | Required |
|---|---|
| `ANTHROPIC_API_KEY` | yes |
| `AURAIS_SIGNING_KEY_PRIV` | no — sets canonical Aurais signing key (base64 PKCS#8 DER) |

## Architecture

This package depends on `@vorionsys/aurais-core` for the proof-chain (`ProofChain`, `hashText`, `hashJSON`, `EventAction`) and CAR identity (`deriveAgentIdentity`, `AgentIdentity`, `DeriveInput`). The per-bot identity constant `MARKET_SCOUT_IDENTITY` lives here in `src/identity.ts`.

## Disclaimer

Nothing in the output is investment advice. Past performance does not predict future results. Aurais is a software tool. You are responsible for your own trading decisions.

## License

Apache-2.0. See `../../LICENSE`.
