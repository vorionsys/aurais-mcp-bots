#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerRequest, ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { deriveAgentIdentity } from "@vorionsys/aurais-core";
import { generateBriefing } from "./lib/briefing.js";
import { MARKET_SCOUT_IDENTITY } from "./identity.js";

// Single source of truth: package version read at runtime from the package
// root (relative to the built dist/index.js). No hardcode to go stale.
const PACKAGE_VERSION: string = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;

type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

// Resolve the Anthropic key from the X-Anthropic-Key request header (HTTP
// transport — caller brings their own key, nothing long-lived on the server)
// or the ANTHROPIC_API_KEY env var (stdio transport). Header wins when present.
function resolveApiKey(extra: ToolExtra): string {
  const header = extra.requestInfo?.headers?.["x-anthropic-key"];
  const fromHeader = (Array.isArray(header) ? header[0] : header)?.trim() ?? "";
  const fromEnv = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
  const key = fromHeader || fromEnv;
  if (!key.startsWith("sk-ant-")) {
    throw new Error(
      "Anthropic API key missing or invalid. Provide it via the ANTHROPIC_API_KEY " +
        "env var (stdio) or the X-Anthropic-Key request header (HTTP).",
    );
  }
  return key;
}

const server = new McpServer({ name: "aurais-market-scout", version: PACKAGE_VERSION });

server.tool(
  "brief_tickers",
  "Generate a structured briefing across up to 10 tickers. For each: last price, RSI(14), MACD (fast/slow/signal/hist), SMA20, SMA50, 20-day return, volume ratio vs 20-day average, relative strength vs SPY over 20 days, and triggered signals (overbought / oversold / uptrend-structure / downtrend-structure / volume anomalies / relative strength flags). Claude writes a bounded per-ticker commentary that cites numbers and names ONE risk. Market data from Yahoo Finance (free, public). Signed Aurais proof chain covers every fetch + computation + commentary.",
  {
    tickers: z.array(z.string().min(1).max(12)).min(1).max(10).describe("Array of 1-10 ticker symbols. Stocks, ETFs, or crypto pairs like BTC-USD. Example: ['AAPL', 'NVDA', 'SPY', 'BTC-USD']."),
    model: z.enum(["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5"]).optional(),
    upstreamProof: z.string().max(128).optional().describe("Optional tipHash from a prior Aurais bot run, recorded in this run's proof chain to link provenance across bots."),
  },
  async ({ tickers, model, upstreamProof }, extra) => {
    let apiKey: string;
    try { apiKey = resolveApiKey(extra); } catch (e) {
      return { isError: true, content: [{ type: "text", text: (e as Error).message }] };
    }
    try {
      const clean = tickers.map((t) => t.trim().toUpperCase()).filter((t) => /^[A-Z0-9.\-]{1,12}$/.test(t));
      if (clean.length === 0) return { isError: true, content: [{ type: "text", text: "no valid tickers" }] };

      const result = await generateBriefing({ tickers: clean, anthropicApiKey: apiKey, model, requestMeta: { clientHint: "mcp-client", upstreamProof, packageVersion: PACKAGE_VERSION } });
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

async function runStdio() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`aurais-mcp-market-scout v${PACKAGE_VERSION} started (stdio)\n`);
}

// HTTP (opt-in: AURAIS_TRANSPORT=http). Stateless; caller passes their own key
// per request via X-Anthropic-Key. Serve behind HTTPS — the key is sent on
// every request, so plain HTTP would expose it.
async function runHttp() {
  const port = Number(process.env.PORT ?? 3000);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const httpServer = createServer((req, res) => {
    if (req.method !== "POST" || new URL(req.url ?? "/", "http://localhost").pathname !== "/mcp") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found. POST MCP requests to /mcp." }));
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      let body: unknown;
      try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined; }
      catch { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "Invalid JSON body" })); return; }
      transport.handleRequest(req, res, body).catch((err: Error) => {
        process.stderr.write(`request error: ${err.message}\n`);
        if (!res.headersSent) { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "internal error" })); }
      });
    });
  });
  httpServer.listen(port, () => {
    process.stderr.write(`aurais-mcp-market-scout v${PACKAGE_VERSION} started (http) on :${port}/mcp — key via X-Anthropic-Key header; serve behind HTTPS\n`);
  });
}

async function main() {
  if ((process.env.AURAIS_TRANSPORT ?? "stdio").toLowerCase() === "http") await runHttp();
  else await runStdio();
}
main().catch((err) => { process.stderr.write(`fatal: ${(err as Error).message}\n`); process.exit(1); });
