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
import { readSource } from "./lib/analyzer.js";
import { RESEARCH_READER_IDENTITY } from "./identity.js";

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

const server = new McpServer({ name: "aurais-research-reader", version: PACKAGE_VERSION });

server.tool(
  "read_source",
  "Extract a structured reading from a source (paper, article, essay). Returns thesis, scope, key claims each with a verbatim quote (post-verified against source), counterpoints (marked external), unanswered questions, and methodology notes if applicable. Every claim's quote is validated character-for-character; invented quotes are flagged in the output. Emits a signed Aurais proof chain with a verifiable 'quotes_verbatim_verified' count.",
  {
    source: z.string().min(100, "source must be at least 100 chars").max(40000, "source must be at most 40000 chars").describe("The text to read critically. Paper, article, essay, blog post."),
    model: z.enum(["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5"]).optional(),
    upstreamProof: z.string().max(128).optional().describe("Optional tipHash from a prior Aurais bot run, recorded in this run's proof chain to link provenance across bots."),
  },
  async ({ source, model, upstreamProof }, extra) => {
    let apiKey: string;
    try { apiKey = resolveApiKey(extra); } catch (e) {
      return { isError: true, content: [{ type: "text", text: (e as Error).message }] };
    }
    try {
      const result = await readSource({ source, anthropicApiKey: apiKey, model, requestMeta: { clientHint: "mcp-client", upstreamProof, packageVersion: PACKAGE_VERSION } });
      const lines = [
        `# Research Reader\n`,
        `## Thesis\n${result.thesis}\n`,
        `## Scope\n${result.scope}\n`,
      ];
      if (result.keyClaims.length) {
        lines.push(`## Key claims (${result.keyClaims.filter((c) => !c.directQuote.startsWith("(quote not found")).length} of ${result.keyClaims.length} verbatim-verified)`);
        result.keyClaims.forEach((c, i) => {
          lines.push(`\n**${i + 1}. ${c.claim}**  _(${c.confidence})_`);
          const verbatim = !c.directQuote.startsWith("(quote not found");
          lines.push(`> ${verbatim ? "" : "⚠ not verbatim: "}"${c.directQuote}"`);
        });
        lines.push("");
      }
      if (result.counterpoints.length) { lines.push("## Counterpoints (external)"); result.counterpoints.forEach((c) => lines.push(`- ${c}`)); lines.push(""); }
      if (result.questionsSourceDoesNotAnswer.length) { lines.push("## Unanswered by source"); result.questionsSourceDoesNotAnswer.forEach((q) => lines.push(`- ${q}`)); lines.push(""); }
      if (result.methodologyNotes) { lines.push("## Methodology\n" + result.methodologyNotes + "\n"); }
      lines.push("## Reader's notes\n" + result.readerNotes + "\n");
      lines.push("---");
      lines.push(`Signed by ${result.proofChain[0]?.key_id ?? "?"} · ${result.proofChain.length} events · tip ${result.tipHash.slice(0, 16)}…`);
      lines.push(`CAR: ${result.agent.carId} · T${result.agent.currentTier} · ${result.agent.registrationStatus}`);
      lines.push("Verify this chain at https://www.aurais.net/verify");
      return {
        content: [
          { type: "text", text: lines.join("\n") },
          { type: "text", text: "\n--- machine-readable JSON ---\n" + JSON.stringify(result, null, 2) },
        ],
      };
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: `read_source failed: ${(e as Error).message}` }] };
    }
  },
);

server.tool(
  "get_agent_identity",
  "Return CAR identity, tier, capabilities without any API call.",
  {},
  async () => {
    const id = deriveAgentIdentity(RESEARCH_READER_IDENTITY);
    return { content: [{ type: "text", text: `Aurais Research Reader v${RESEARCH_READER_IDENTITY.version}\nCAR: ${id.carId}\nTier: T${id.currentTier}\n` + JSON.stringify(id, null, 2) }] };
  },
);

async function runStdio() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`aurais-mcp-research-reader v${PACKAGE_VERSION} started (stdio)\n`);
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
    process.stderr.write(`aurais-mcp-research-reader v${PACKAGE_VERSION} started (http) on :${port}/mcp — key via X-Anthropic-Key header; serve behind HTTPS\n`);
  });
}

async function main() {
  if ((process.env.AURAIS_TRANSPORT ?? "stdio").toLowerCase() === "http") await runHttp();
  else await runStdio();
}
main().catch((err) => { process.stderr.write(`fatal: ${(err as Error).message}\n`); process.exit(1); });
