#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerRequest, ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import { deriveAgentIdentity } from "@vorionsys/aurais-core";
import { analyzeJournal } from "./lib/analyzer.js";
import { JOURNAL_COMPANION_IDENTITY } from "./identity.js";

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

const server = new McpServer({ name: "aurais-journal-companion", version: PACKAGE_VERSION });

server.tool(
  "reflect_on_entry",
  "Take a single journal entry and return a structured reflection: mood score (-5 to +5), one-or-two-word mood label, 2-5 themes, 0-3 gratitude items, 2-3 sentences of gentle observations, and ONE gentle question for tomorrow. Never diagnoses. If entry mentions crisis/self-harm content, returns a safety response with crisis-line contacts (988 / 111 / findahelpline.com). Emits a signed Aurais proof chain.",
  {
    entry: z.string().min(10, "entry must be at least 10 chars").max(8000, "entry must be at most 8000 chars").describe("The journal entry to reflect on. Any tone, any length 10-8000 chars."),
    model: z.enum(["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5"]).optional(),
    upstreamProof: z.string().max(128).optional().describe("Optional tipHash from a prior Aurais bot run, recorded in this run's proof chain to link provenance across bots."),
  },
  async ({ entry, model, upstreamProof }, extra) => {
    let apiKey: string;
    try { apiKey = resolveApiKey(extra); } catch (e) {
      return { isError: true, content: [{ type: "text", text: (e as Error).message }] };
    }
    try {
      const result = await analyzeJournal({ entry, anthropicApiKey: apiKey, model, requestMeta: { clientHint: "mcp-client", upstreamProof, packageVersion: PACKAGE_VERSION } });
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

// ---------- OAuth 2.1 resource-server mode (HTTP transport only, opt-in) ----------
// Per the MCP authorization spec (2025-06-18). Enabled by setting BOTH
// AURAIS_OAUTH_ISSUER (the AS issuer URL, RFC 8414) and AURAIS_OAUTH_RESOURCE
// (this server's canonical resource URI, RFC 8707 — e.g. https://host/mcp).
// Bearer JWTs are validated against the issuer's JWKS with audience binding
// (`aud` must equal AURAIS_OAUTH_RESOURCE — a spec MUST); RFC 9728 metadata is
// served for discovery; failures get 401 + WWW-Authenticate. OAuth
// authenticates the caller — X-Anthropic-Key still supplies their Anthropic
// key (BYOK unchanged), and the inbound token is never forwarded upstream.

const OAUTH_ISSUER = (process.env.AURAIS_OAUTH_ISSUER ?? "").replace(/\/+$/, "");
const OAUTH_RESOURCE = (process.env.AURAIS_OAUTH_RESOURCE ?? "").replace(/\/+$/, "");
const OAUTH_ENABLED = Boolean(OAUTH_ISSUER || OAUTH_RESOURCE);

let jwksCache: ReturnType<typeof createRemoteJWKSet> | undefined;

// Discover the AS's JWKS via RFC 8414 / OIDC metadata (path-insertion form
// first, legacy OIDC suffix form last); jose caches and rotates keys per kid.
async function getJwks(): Promise<NonNullable<typeof jwksCache>> {
  if (jwksCache) return jwksCache;
  const issuer = new URL(OAUTH_ISSUER);
  const path = issuer.pathname.replace(/\/$/, "");
  const candidates = [
    `${issuer.origin}/.well-known/oauth-authorization-server${path}`,
    `${issuer.origin}/.well-known/openid-configuration${path}`,
  ];
  if (path) candidates.push(`${issuer.origin}${path}/.well-known/openid-configuration`);
  for (const metaUrl of candidates) {
    try {
      const resp = await fetch(metaUrl);
      if (!resp.ok) continue;
      const meta = (await resp.json()) as { jwks_uri?: string };
      if (meta.jwks_uri) {
        jwksCache = createRemoteJWKSet(new URL(meta.jwks_uri));
        return jwksCache;
      }
    } catch {
      // unreachable candidate — try the next metadata location
    }
  }
  throw new Error(`could not discover jwks_uri from issuer ${OAUTH_ISSUER}`);
}

async function verifyBearer(authorization: string | undefined): Promise<void> {
  const token = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1];
  if (!token) throw new Error("missing bearer token");
  await jwtVerify(token, await getJwks(), {
    issuer: OAUTH_ISSUER,
    audience: OAUTH_RESOURCE,
    clockTolerance: 5,
  });
}

// RFC 9728: metadata path is /.well-known/oauth-protected-resource with the
// resource's path appended (resource …/mcp → …/oauth-protected-resource/mcp).
function resourceMetadataPath(): string {
  return "/.well-known/oauth-protected-resource" + new URL(OAUTH_RESOURCE).pathname.replace(/\/$/, "");
}

function sendUnauthorized(res: ServerResponse, reason: string): void {
  const metaUrl = new URL(OAUTH_RESOURCE).origin + resourceMetadataPath();
  res.writeHead(401, {
    "content-type": "application/json",
    "www-authenticate": `Bearer error="invalid_token", error_description="${reason.replace(/"/g, "'")}", resource_metadata="${metaUrl}"`,
  });
  res.end(JSON.stringify({ error: "unauthorized", reason }));
}

async function runStdio() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`aurais-mcp-journal-companion v${PACKAGE_VERSION} started (stdio)\n`);
}

// HTTP (opt-in: AURAIS_TRANSPORT=http). Stateless; caller passes their own key
// per request via X-Anthropic-Key. Serve behind HTTPS — the key is sent on
// every request, so plain HTTP would expose it. Optionally an OAuth 2.1
// resource server (see the OAuth section above).
async function runHttp() {
  const port = Number(process.env.PORT ?? 3000);
  if (OAUTH_ENABLED) {
    if (!OAUTH_ISSUER || !OAUTH_RESOURCE) {
      throw new Error("OAuth mode needs BOTH AURAIS_OAUTH_ISSUER and AURAIS_OAUTH_RESOURCE set");
    }
    new URL(OAUTH_ISSUER);
    new URL(OAUTH_RESOURCE); // fail fast on malformed URLs
  }
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (
      OAUTH_ENABLED &&
      req.method === "GET" &&
      (pathname === "/.well-known/oauth-protected-resource" || pathname === resourceMetadataPath())
    ) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        resource: OAUTH_RESOURCE,
        authorization_servers: [OAUTH_ISSUER],
        bearer_methods_supported: ["header"],
      }));
      return;
    }
    if (req.method !== "POST" || pathname !== "/mcp") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found. POST MCP requests to /mcp." }));
      return;
    }
    if (OAUTH_ENABLED) {
      try {
        await verifyBearer(req.headers.authorization);
      } catch (e) {
        sendUnauthorized(res, (e as Error).message);
        return;
      }
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    let body: unknown;
    try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined; }
    catch { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "Invalid JSON body" })); return; }
    await transport.handleRequest(req, res, body);
  }

  const httpServer = createServer((req, res) => {
    handle(req, res).catch((err: Error) => {
      process.stderr.write(`request error: ${err.message}\n`);
      if (!res.headersSent) { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "internal error" })); }
    });
  });
  httpServer.listen(port, () => {
    process.stderr.write(`aurais-mcp-journal-companion v${PACKAGE_VERSION} started (http) on :${port}/mcp — key via X-Anthropic-Key header; ${OAUTH_ENABLED ? `OAuth resource server (issuer ${OAUTH_ISSUER}); ` : ""}serve behind HTTPS\n`);
  });
}

async function main() {
  if ((process.env.AURAIS_TRANSPORT ?? "stdio").toLowerCase() === "http") await runHttp();
  else await runStdio();
}
main().catch((err) => { process.stderr.write(`fatal: ${(err as Error).message}\n`); process.exit(1); });
