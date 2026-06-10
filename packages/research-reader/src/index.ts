#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { deriveAgentIdentity } from "@vorionsys/aurais-core";
import { readSource } from "./lib/analyzer.js";
import { RESEARCH_READER_IDENTITY } from "./identity.js";

// Single source of truth: package version read at runtime from the package
// root (relative to the built dist/index.js). No hardcode to go stale.
const PACKAGE_VERSION: string = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;

function requireApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
  if (!key.startsWith("sk-ant-")) throw new Error("ANTHROPIC_API_KEY env var missing or invalid.");
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
  async ({ source, model, upstreamProof }) => {
    let apiKey: string;
    try { apiKey = requireApiKey(); } catch (e) {
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`aurais-mcp-research-reader v${PACKAGE_VERSION} started (stdio)\n`);
}
main().catch((err) => { process.stderr.write(`fatal: ${(err as Error).message}\n`); process.exit(1); });
