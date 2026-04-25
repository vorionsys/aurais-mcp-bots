#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { deriveAgentIdentity } from "@vorionsys/aurais-core";
import { generateBriefing } from "./lib/briefing.js";
import { MARKET_SCOUT_IDENTITY } from "./identity.js";

const PACKAGE_VERSION = "0.2.0";

function requireApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
  if (!key.startsWith("sk-ant-")) throw new Error("ANTHROPIC_API_KEY env var missing or invalid.");
  return key;
}

const server = new McpServer({ name: "aurais-market-scout", version: PACKAGE_VERSION });

server.tool(
  "brief_tickers",
  "Generate a structured briefing across up to 10 tickers. For each: last price, RSI(14), MACD (fast/slow/signal/hist), SMA20, SMA50, 20-day return, volume ratio vs 20-day average, relative strength vs SPY over 20 days, and triggered signals (overbought / oversold / uptrend-structure / downtrend-structure / volume anomalies / relative strength flags). Claude writes a bounded per-ticker commentary that cites numbers and names ONE risk. Market data from Yahoo Finance (free, public). Signed Aurais proof chain covers every fetch + computation + commentary.",
  {
    tickers: z.array(z.string().min(1).max(12)).min(1).max(10).describe("Array of 1-10 ticker symbols. Stocks, ETFs, or crypto pairs like BTC-USD. Example: ['AAPL', 'NVDA', 'SPY', 'BTC-USD']."),
    model: z.enum(["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5"]).optional(),
  },
  async ({ tickers, model }) => {
    let apiKey: string;
    try { apiKey = requireApiKey(); } catch (e) {
      return { isError: true, content: [{ type: "text", text: (e as Error).message }] };
    }
    try {
      const clean = tickers.map((t) => t.trim().toUpperCase()).filter((t) => /^[A-Z0-9.\-]{1,12}$/.test(t));
      if (clean.length === 0) return { isError: true, content: [{ type: "text", text: "no valid tickers" }] };

      const result = await generateBriefing({ tickers: clean, anthropicApiKey: apiKey, model, requestMeta: { clientHint: "mcp-client" } });
      const lines: string[] = [
        `# Market Scout — ${new Date(result.generatedAt).toISOString().slice(0, 10)}`,
        `Aggregate: overbought ${result.aggregate.overbought} · oversold ${result.aggregate.oversold} · uptrend ${result.aggregate.uptrend} · downtrend ${result.aggregate.downtrend}`,
        result.spyReturn20d !== null ? `SPY 20d: ${result.spyReturn20d >= 0 ? "+" : ""}${result.spyReturn20d}%` : "",
        "",
      ];
      for (const it of result.items) {
        if (!it.ok) { lines.push(`## ${it.ticker} — data unavailable: ${it.error}\n`); continue; }
        const s = it.snapshot;
        const arrow = s.changePct >= 0 ? "▲" : "▼";
        lines.push(`## ${s.ticker}  \$${s.last}  ${arrow} ${s.changePct >= 0 ? "+" : ""}${s.changePct}%`);
        lines.push(it.commentary);
        const extras: string[] = [];
        if (s.return20d !== null) extras.push(`20d ${s.return20d >= 0 ? "+" : ""}${s.return20d}%`);
        if (s.volRatio !== null) extras.push(`vol ${s.volRatio}x`);
        if (s.relStrength20d !== null) extras.push(`vs SPY ${s.relStrength20d >= 0 ? "+" : ""}${s.relStrength20d}pp`);
        lines.push(`_RSI ${s.rsi14} · MACD ${s.macd >= 0 ? "+" : ""}${s.macd} (h ${s.macdHist >= 0 ? "+" : ""}${s.macdHist}) · SMA20 ${s.sma20} · SMA50 ${s.sma50}${extras.length ? " · " + extras.join(" · ") : ""}${s.signals.length ? " · signals: " + s.signals.join(", ") : ""}_`);
        lines.push("");
      }
      lines.push("---");
      lines.push("_Not investment advice. Past performance does not predict future results. Aurais is a software tool._");
      lines.push(`Signed by ${result.proofChain[0]?.key_id ?? "?"} · ${result.proofChain.length} events · tip ${result.tipHash.slice(0, 16)}…`);
      lines.push(`CAR: ${result.agent.carId} · T${result.agent.currentTier} · ${result.agent.registrationStatus}`);
      lines.push("Verify at https://www.aurais.net/verify");
      return {
        content: [
          { type: "text", text: lines.join("\n") },
          { type: "text", text: "\n--- machine-readable JSON ---\n" + JSON.stringify(result, null, 2) },
        ],
      };
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: `brief_tickers failed: ${(e as Error).message}` }] };
    }
  },
);

server.tool(
  "get_agent_identity",
  "Return CAR identity, tier, capabilities without any API call.",
  {},
  async () => {
    const id = deriveAgentIdentity(MARKET_SCOUT_IDENTITY);
    return { content: [{ type: "text", text: `Aurais Market Scout v${MARKET_SCOUT_IDENTITY.version}\nCAR: ${id.carId}\nTier: T${id.currentTier}\n` + JSON.stringify(id, null, 2) }] };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`aurais-mcp-market-scout v${PACKAGE_VERSION} started (stdio)\n`);
}
main().catch((err) => { process.stderr.write(`fatal: ${(err as Error).message}\n`); process.exit(1); });
