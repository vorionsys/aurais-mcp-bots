import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { generateKeyPair, exportJWK, SignJWT } from "jose";

// End-to-end test of the OAuth 2.1 resource-server mode: a minimal local
// authorization server (RFC 8414 metadata + JWKS) mints real ES256 JWTs, and
// the built bot (dist/index.js) is spawned in HTTP mode pointing at it.
// Verifies the MCP auth spec MUSTs: bearer validation (signature, issuer,
// audience binding, expiry), RFC 9728 protected-resource metadata, and
// 401 + WWW-Authenticate on failure. No network beyond localhost.

const BOT_ENTRY = fileURLToPath(new URL("../dist/index.js", import.meta.url));

async function freePort() {
  return await new Promise((resolve) => {
    const srv = createNetServer().listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHttp(url, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await fetch(url);
      return; // any HTTP response (even 404) means the server is up
    } catch {
      if (Date.now() > deadline) throw new Error(`server at ${url} did not come up`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

function spawnBot(env) {
  const child = spawn(process.execPath, [BOT_ENTRY], {
    env: { ...process.env, ANTHROPIC_API_KEY: "", ...env },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.setEncoding("utf8");
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  return { child, getStderr: () => stderr };
}

// ---------- fixture state ----------
let signKeys; // { privateKey, publicKey }
let forgeKeys; // a different keypair, NOT in the JWKS
const KID = "test-key-1";
let asServer;
let issuer;
let bot;
let botPort;
let resource;

async function mint({ aud = () => resource, iss = () => issuer, expired = false, keys = () => signKeys } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: KID })
    .setIssuer(iss())
    .setAudience(aud())
    .setSubject("test-user")
    .setIssuedAt(expired ? now - 3600 : now)
    .setExpirationTime(expired ? now - 1800 : now + 300)
    .sign(keys().privateKey);
}

async function mcpInitialize(port, headers = {}) {
  return await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    }),
  });
}

before(async () => {
  signKeys = await generateKeyPair("ES256");
  forgeKeys = await generateKeyPair("ES256");
  const jwk = await exportJWK(signKeys.publicKey);
  jwk.kid = KID;
  jwk.alg = "ES256";

  const asPort = await freePort();
  issuer = `http://127.0.0.1:${asPort}`;
  asServer = createServer((req, res) => {
    if (req.url === "/.well-known/oauth-authorization-server") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ issuer, jwks_uri: `${issuer}/jwks` }));
    } else if (req.url === "/jwks") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ keys: [jwk] }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => asServer.listen(asPort, r));

  botPort = await freePort();
  resource = `http://127.0.0.1:${botPort}/mcp`;
  bot = spawnBot({
    AURAIS_TRANSPORT: "http",
    PORT: String(botPort),
    AURAIS_OAUTH_ISSUER: issuer,
    AURAIS_OAUTH_RESOURCE: resource,
  });
  await waitForHttp(`http://127.0.0.1:${botPort}/`);
});

after(() => {
  bot?.child.kill();
  asServer?.close();
});

test("RFC 9728 protected-resource metadata is served at both well-known forms", async () => {
  for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
    const res = await fetch(`http://127.0.0.1:${botPort}${path}`);
    assert.equal(res.status, 200, path);
    const meta = await res.json();
    assert.equal(meta.resource, resource);
    assert.deepEqual(meta.authorization_servers, [issuer]);
  }
});

test("request without a token → 401 with WWW-Authenticate pointing at resource metadata", async () => {
  const res = await mcpInitialize(botPort);
  assert.equal(res.status, 401);
  const www = res.headers.get("www-authenticate") ?? "";
  assert.match(www, /^Bearer /);
  assert.ok(www.includes("resource_metadata="), "WWW-Authenticate carries resource_metadata");
  assert.ok(www.includes("/.well-known/oauth-protected-resource"), "metadata URL present");
});

test("valid token → MCP initialize succeeds", async () => {
  const res = await mcpInitialize(botPort, { authorization: `Bearer ${await mint()}` });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.result.serverInfo.name, "aurais-meeting-distiller");
});

test("token with wrong audience → 401 (RFC 8707 audience binding)", async () => {
  const token = await mint({ aud: () => "https://some-other-server.example/mcp" });
  const res = await mcpInitialize(botPort, { authorization: `Bearer ${token}` });
  assert.equal(res.status, 401);
});

test("token with wrong issuer → 401", async () => {
  const token = await mint({ iss: () => "https://evil-as.example" });
  const res = await mcpInitialize(botPort, { authorization: `Bearer ${token}` });
  assert.equal(res.status, 401);
});

test("token signed by a key outside the JWKS → 401 (forged signature)", async () => {
  const token = await mint({ keys: () => forgeKeys });
  const res = await mcpInitialize(botPort, { authorization: `Bearer ${token}` });
  assert.equal(res.status, 401);
});

test("expired token → 401", async () => {
  const token = await mint({ expired: true });
  const res = await mcpInitialize(botPort, { authorization: `Bearer ${token}` });
  assert.equal(res.status, 401);
});

test("without OAuth env vars, HTTP mode requires no token (backward compatible)", async () => {
  const port = await freePort();
  const plain = spawnBot({ AURAIS_TRANSPORT: "http", PORT: String(port) });
  try {
    await waitForHttp(`http://127.0.0.1:${port}/`);
    const res = await mcpInitialize(port);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.result.serverInfo.name, "aurais-meeting-distiller");
  } finally {
    plain.child.kill();
  }
});
