#!/usr/bin/env node
/**
 * @vorionsys/aurais-mcp-meeting-distiller
 *
 * MCP server exposing the Aurais Meeting Distiller bot.
 * Configure in Claude Desktop / Claude Code / any MCP client:
 *
 * {
 *   "mcpServers": {
 *     "aurais-meeting-distiller": {
 *       "command": "npx",
 *       "args": ["-y", "@vorionsys/aurais-mcp-meeting-distiller"],
 *       "env": {
 *         "ANTHROPIC_API_KEY": "sk-ant-...",
 *         "AURAIS_SIGNING_KEY_PRIV": "<optional base64 PKCS8 to co-sign with the canonical Aurais key>"
 *       }
 *     }
 *   }
 * }
 *
 * Exposes two tools:
 *   - distill_meeting  → takes a transcript string, returns structured output + proof chain
 *   - get_agent_identity → returns the bot's CAR ID, tier, capabilities (no API call)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { deriveAgentIdentity } from "@vorionsys/aurais-core";
import { distillMeeting } from "./lib/distiller.js";
import { MEETING_DISTILLER_IDENTITY } from "./identity.js";

const PACKAGE_VERSION = "0.3.0";

function requireApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
  if (!key.startsWith("sk-ant-")) {
    throw new Error(
      "ANTHROPIC_API_KEY env var missing or invalid. Set it in the MCP client's config.",
    );
  }
  return key;
}

const server = new McpServer({
  name: "aurais-meeting-distiller",
  version: PACKAGE_VERSION,
});

server.tool(
  "distill_meeting",
  "Extract structured meeting outcomes from a transcript or notes: title, decisions, action items (with owner + due date if named), follow-ups, open questions, risks, and participants mentioned. Output is JSON, and the full run produces a signed Aurais proof chain with CAR identity.",
  {
    transcript: z
      .string()
      .min(30, "transcript must be at least 30 chars")
      .max(30000, "transcript must be at most 30000 chars")
      .describe("The raw transcript or meeting notes to distill."),
    model: z
      .enum(["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5"])
      .optional()
      .describe("Which Claude model to use. Defaults to claude-sonnet-4-5."),
  },
  async ({ transcript, model }) => {
    let apiKey: string;
    try {
      apiKey = requireApiKey();
    } catch (e) {
      return {
        isError: true,
        content: [{ type: "text", text: (e as Error).message }],
      };
    }

    try {
      const result = await distillMeeting({
        transcript,
        anthropicApiKey: apiKey,
        model,
        requestMeta: { clientHint: "mcp-client" },
      });
      // Return a dense text summary for LLM consumption + full JSON for programmatic use
      const summaryText = formatHumanSummary(result);
      return {
        content: [
          { type: "text", text: summaryText },
          {
            type: "text",
            text:
              "\n\n--- machine-readable JSON (includes proof chain) ---\n" +
              JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (e) {
      return {
        isError: true,
        content: [{ type: "text", text: `distill_meeting failed: ${(e as Error).message}` }],
      };
    }
  },
);

server.tool(
  "get_agent_identity",
  "Return this bot's CAR identity, trust tier, capabilities, and deployment fingerprint without making any external API call. Useful for verifying which bot is loaded before invoking it.",
  {},
  async () => {
    const id = deriveAgentIdentity(MEETING_DISTILLER_IDENTITY);
    return {
      content: [
        {
          type: "text",
          text:
            `Aurais Meeting Distiller v${MEETING_DISTILLER_IDENTITY.version}\n` +
            `CAR ID: ${id.carId}\n` +
            `Agent ID: ${id.agentId}\n` +
            `Org: ${id.orgId}\n` +
            `Deployment: ${id.deploymentId}\n` +
            `Tier: T${id.currentTier} (ceiling ${id.trustCeiling}, max earnable T${id.maxEarnableTier})\n` +
            `Registration: ${id.registrationStatus}\n` +
            `Context hash: ${id.contextHash}\n` +
            `Capabilities (${id.capabilities.length}):\n` +
            id.capabilities.map((c) => `  - ${c}`).join("\n"),
        },
        {
          type: "text",
          text: "\n--- JSON ---\n" + JSON.stringify(id, null, 2),
        },
      ],
    };
  },
);

// ---------- helpers ----------

function formatHumanSummary(result: import("./lib/distiller.js").MeetingResult): string {
  const d = result.distilled;
  const lines: string[] = [];
  lines.push(`# ${d.title || "Meeting"}\n`);

  if (d.decisions.length) {
    lines.push("## Decisions");
    d.decisions.forEach((x) => lines.push(`- ${x}`));
    lines.push("");
  }
  if (d.actionItems.length) {
    lines.push("## Action items");
    d.actionItems.forEach((a) => {
      const meta = [a.owner && `owner: ${a.owner}`, a.due && `due: ${a.due}`].filter(Boolean).join(" · ");
      lines.push(`- ${a.what}${meta ? ` — ${meta}` : ""}`);
    });
    lines.push("");
  }
  if (d.followUps.length) {
    lines.push("## Follow-ups");
    d.followUps.forEach((x) => lines.push(`- ${x}`));
    lines.push("");
  }
  if (d.openQuestions.length) {
    lines.push("## Open questions");
    d.openQuestions.forEach((x) => lines.push(`- ${x}`));
    lines.push("");
  }
  if (d.risks.length) {
    lines.push("## Risks");
    d.risks.forEach((x) => lines.push(`- ${x}`));
    lines.push("");
  }
  if (d.participantsMentioned.length) {
    lines.push(`## Participants mentioned: ${d.participantsMentioned.join(", ")}\n`);
  }

  lines.push("---");
  lines.push(
    `Proof chain: ${result.proofChain.length} signed events · key ${result.proofChain[0]?.key_id ?? "?"} · tip ${result.tipHash.slice(0, 16)}…`,
  );
  lines.push(`Agent CAR: ${result.agent.carId} · T${result.agent.currentTier} · ${result.agent.registrationStatus}`);
  lines.push("Verify this chain at https://www.aurais.net/verify");

  return lines.join("\n");
}

// ---------- main ----------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // MCP servers run until the client disconnects; do not log to stdout (MCP uses stdio).
  process.stderr.write(`aurais-mcp-meeting-distiller v${PACKAGE_VERSION} started (stdio)\n`);
}
main().catch((err) => {
  process.stderr.write(`fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
