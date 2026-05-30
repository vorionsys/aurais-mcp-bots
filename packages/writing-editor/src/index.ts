#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { deriveAgentIdentity } from "@vorionsys/aurais-core";
import { editDraft, type EditorSuggestion } from "./lib/analyzer.js";
import { WRITING_EDITOR_IDENTITY } from "./identity.js";

const PACKAGE_VERSION = "0.3.0";

function requireApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
  if (!key.startsWith("sk-ant-")) throw new Error("ANTHROPIC_API_KEY env var missing or invalid.");
  return key;
}

const server = new McpServer({ name: "aurais-writing-editor", version: PACKAGE_VERSION });

server.tool(
  "critique_draft",
  "Critique a draft — structural, sentence-level (clarity, repetition, tightening), and tone — WITHOUT rewriting it. Every suggestion is directional (never a replacement sentence) and cites a verbatim excerpt from the draft when possible. Your voice stays yours; the bot only points out problems. Emits a signed Aurais proof chain.",
  {
    draft: z.string().min(50, "draft must be at least 50 chars").max(20000, "draft must be at most 20000 chars"),
    audience: z.string().min(1, "audience required").max(300),
    tone: z.string().min(1, "tone required").max(100),
    model: z.enum(["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5"]).optional(),
  },
  async ({ draft, audience, tone, model }) => {
    let apiKey: string;
    try { apiKey = requireApiKey(); } catch (e) {
      return { isError: true, content: [{ type: "text", text: (e as Error).message }] };
    }
    try {
      const result = await editDraft({ draft, audience, tone, anthropicApiKey: apiKey, model, requestMeta: { clientHint: "mcp-client" } });
      const fmt = (s: EditorSuggestion) => {
        const verbatim = s.exampleFromDraft !== null && !s.exampleFromDraft.startsWith("(paraphrased");
        const excerpt = s.exampleFromDraft ? `\n  ${verbatim ? "" : "⚠ "}"${s.exampleFromDraft}"` : "";
        return `- [${s.kind}] ${s.issue}${excerpt}\n  → ${s.suggestionForAuthor}`;
      };
      const lines: string[] = [
        `# Writing critique\n`,
        `**Audience:** ${audience}  ·  **Target tone:** ${tone}\n`,
        `## Overall\n${result.overallReadabilityNotes}\n`,
      ];
      if (result.structuralIssues.length) { lines.push("## Structural"); result.structuralIssues.forEach((s) => lines.push(fmt(s))); lines.push(""); }
      if (result.sentenceLevel.length) { lines.push("## Sentence-level"); result.sentenceLevel.forEach((s) => lines.push(fmt(s))); lines.push(""); }
      if (result.toneAudit.length) { lines.push("## Tone"); result.toneAudit.forEach((s) => lines.push(fmt(s))); lines.push(""); }
      if (result.strengths.length) { lines.push("## Strengths"); result.strengths.forEach((s) => lines.push(`- ${s}`)); lines.push(""); }
      lines.push("---");
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
      return { isError: true, content: [{ type: "text", text: `critique_draft failed: ${(e as Error).message}` }] };
    }
  },
);

server.tool(
  "get_agent_identity",
  "Return CAR identity, tier, capabilities without any API call.",
  {},
  async () => {
    const id = deriveAgentIdentity(WRITING_EDITOR_IDENTITY);
    return { content: [{ type: "text", text: `Aurais Writing Editor v${WRITING_EDITOR_IDENTITY.version}\nCAR: ${id.carId}\nTier: T${id.currentTier}\n` + JSON.stringify(id, null, 2) }] };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`aurais-mcp-writing-editor v${PACKAGE_VERSION} started (stdio)\n`);
}
main().catch((err) => { process.stderr.write(`fatal: ${(err as Error).message}\n`); process.exit(1); });
