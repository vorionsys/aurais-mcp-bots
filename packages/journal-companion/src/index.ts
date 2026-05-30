#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { deriveAgentIdentity } from "@vorionsys/aurais-core";
import { analyzeJournal } from "./lib/analyzer.js";
import { JOURNAL_COMPANION_IDENTITY } from "./identity.js";

const PACKAGE_VERSION = "0.3.0";

function requireApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
  if (!key.startsWith("sk-ant-")) throw new Error("ANTHROPIC_API_KEY env var missing or invalid.");
  return key;
}

const server = new McpServer({ name: "aurais-journal-companion", version: PACKAGE_VERSION });

server.tool(
  "reflect_on_entry",
  "Take a single journal entry and return a structured reflection: mood score (-5 to +5), one-or-two-word mood label, 2-5 themes, 0-3 gratitude items, 2-3 sentences of gentle observations, and ONE gentle question for tomorrow. Never diagnoses. If entry mentions crisis/self-harm content, returns a safety response with crisis-line contacts (988 / 111 / findahelpline.com). Emits a signed Aurais proof chain.",
  {
    entry: z.string().min(10, "entry must be at least 10 chars").max(8000, "entry must be at most 8000 chars").describe("The journal entry to reflect on. Any tone, any length 10-8000 chars."),
    model: z.enum(["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5"]).optional(),
  },
  async ({ entry, model }) => {
    let apiKey: string;
    try { apiKey = requireApiKey(); } catch (e) {
      return { isError: true, content: [{ type: "text", text: (e as Error).message }] };
    }
    try {
      const result = await analyzeJournal({ entry, anthropicApiKey: apiKey, model, requestMeta: { clientHint: "mcp-client" } });
      const { analysis, agent, proofChain, tipHash } = result;
      const lines = [
        `MOOD · ${analysis.moodLabel} · ${analysis.moodScore >= 0 ? "+" : ""}${analysis.moodScore}\n`,
      ];
      if (analysis.themes.length) { lines.push("THEMES"); analysis.themes.forEach((t) => lines.push(`- ${t}`)); lines.push(""); }
      if (analysis.gratitude.length) { lines.push("GRATITUDE"); analysis.gratitude.forEach((t) => lines.push(`- ${t}`)); lines.push(""); }
      lines.push("OBSERVATIONS"); lines.push(analysis.observationsOnPattern); lines.push("");
      lines.push("QUESTION FOR TOMORROW"); lines.push(analysis.gentleQuestion); lines.push("");
      lines.push("---");
      lines.push(`Signed by ${proofChain[0]?.key_id ?? "?"} · ${proofChain.length} events · tip ${tipHash.slice(0, 16)}…`);
      lines.push(`CAR: ${agent.carId} · T${agent.currentTier} · ${agent.registrationStatus}`);
      lines.push("Verify this chain at https://www.aurais.net/verify");
      return {
        content: [
          { type: "text", text: lines.join("\n") },
          { type: "text", text: "\n--- machine-readable JSON ---\n" + JSON.stringify(result, null, 2) },
        ],
      };
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: `reflect_on_entry failed: ${(e as Error).message}` }] };
    }
  },
);

server.tool(
  "get_agent_identity",
  "Return this bot's CAR identity, tier, capabilities, and deployment fingerprint without making any external API call.",
  {},
  async () => {
    const id = deriveAgentIdentity(JOURNAL_COMPANION_IDENTITY);
    return {
      content: [
        { type: "text", text: `Aurais Journal Companion v${JOURNAL_COMPANION_IDENTITY.version}\nCAR: ${id.carId}\nTier: T${id.currentTier} (ceiling ${id.trustCeiling})\nCapabilities: ${id.capabilities.length}\nRegistration: ${id.registrationStatus}` },
        { type: "text", text: "\n" + JSON.stringify(id, null, 2) },
      ],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`aurais-mcp-journal-companion v${PACKAGE_VERSION} started (stdio)\n`);
}
main().catch((err) => { process.stderr.write(`fatal: ${(err as Error).message}\n`); process.exit(1); });
