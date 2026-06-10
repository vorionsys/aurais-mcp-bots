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

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerRequest, ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { deriveAgentIdentity } from "@vorionsys/aurais-core";
import { distillMeeting } from "./lib/distiller.js";
import { MEETING_DISTILLER_IDENTITY } from "./identity.js";

// Single source of truth: the published package version, read from the
// package.json at the package root (resolved relative to the built
// dist/index.js at runtime). Avoids a hardcode that goes stale every release.
const PACKAGE_VERSION: string = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;

type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/**
 * Resolve the Anthropic API key for a tool call from one of two sources:
 *
 *  - stdio transport (local): the ANTHROPIC_API_KEY env var, set in the MCP
 *    client's config — the original BYOK model.
 *  - HTTP transport (remote): the per-request `X-Anthropic-Key` header, so the
 *    caller supplies (and pays for) their own key. No long-lived key lives on
 *    the server. MUST be served over HTTPS, since the key is sent per request.
 *
 * Header takes precedence when present so the same build serves both modes.
 */
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
    upstreamProof: z
      .string()
      .max(128)
      .optional()
      .describe(
        "Optional tipHash from a prior Aurais bot run that produced this transcript " +
          "(e.g. another distiller or research-reader). Recorded in this run's proof " +
          "chain to link provenance across bots — lets a verifier trace this output " +
          "back to its upstream source.",
      ),
  },
  async ({ transcript, model, upstreamProof }, extra) => {
    let apiKey: string;
    try {
      apiKey = resolveApiKey(extra);
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
        requestMeta: { clientHint: "mcp-client", upstreamProof, packageVersion: PACKAGE_VERSION },
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

// ---------- transports ----------

// stdio (default): local use in Claude Desktop / Claude Code. Key comes from
// the ANTHROPIC_API_KEY env var in the client config.
async function runStdio() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // MCP servers run until the client disconnects; do not log to stdout (MCP uses stdio).
  process.stderr.write(`aurais-mcp-meeting-distiller v${PACKAGE_VERSION} started (stdio)\n`);
}

// HTTP (opt-in via AURAIS_TRANSPORT=http): remote use. The caller supplies
// their own Anthropic key per request via the X-Anthropic-Key header, so no
// long-lived key lives on the server. Stateless (no session id). Serve behind
// HTTPS/TLS in production — the key is sent on every request.
async function runHttp() {
  const port = Number(process.env.PORT ?? 3000);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
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
      try {
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
        return;
      }
      transport.handleRequest(req, res, body).catch((err: Error) => {
        process.stderr.write(`request error: ${err.message}\n`);
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "internal error" }));
        }
      });
    });
  });

  httpServer.listen(port, () => {
    process.stderr.write(
      `aurais-mcp-meeting-distiller v${PACKAGE_VERSION} started (http) on :${port}/mcp — ` +
        `key via X-Anthropic-Key header; serve behind HTTPS\n`,
    );
  });
}

async function main() {
  if ((process.env.AURAIS_TRANSPORT ?? "stdio").toLowerCase() === "http") {
    await runHttp();
  } else {
    await runStdio();
  }
}
main().catch((err) => {
  process.stderr.write(`fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
