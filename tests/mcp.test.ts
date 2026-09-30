/**
 * The Claude connector (2026-09-28): the sealed OAuth artefacts and the
 * JSON-RPC exchange. lib/mcp-auth.ts and lib/mcp-protocol.ts are pure, so
 * the whole handshake runs here without the sheet or the network.
 *
 * Run with `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  connectorKey, seal, unseal, openClient, clientSecretFor, clientHash, pkceOk,
  redirectAllowed, redirectMatches, issueTokens, nowS,
  type AccessClaims, type CodeClaims, type RefreshClaims,
} from "../lib/mcp-auth.ts";
import { handleRpc, negotiateVersion, toolText, MAX_TEXT, type ServerSpec } from "../lib/mcp-protocol.ts";

const KEY = connectorKey({ STORAGE_APPS_SCRIPT_SECRET: "storage-secret" })!;
const OTHER = connectorKey({ MCP_TOKEN_SECRET: "rotated" })!;

test("the key: MCP_TOKEN_SECRET wins, else derived from the storage secret, else off", () => {
  assert.equal(connectorKey({}), null);
  assert.ok(KEY && KEY.length === 32);
  assert.notDeepEqual(KEY, OTHER);
  assert.notEqual(KEY.toString(), "storage-secret", "the secret itself is never the key");
  assert.deepEqual(connectorKey({ MCP_TOKEN_SECRET: "rotated", STORAGE_APPS_SCRIPT_SECRET: "storage-secret" }), OTHER);
});

test("the main bridge secret is never key material — it is in the public repo", () => {
  // apps-script.gs carries GOOGLE_APPS_SCRIPT_SECRET in plain text and the repo
  // was found public on 2026-09-28: a key derived from it could be computed by
  // anyone. Alone it must leave the connector OFF, and beside the storage
  // secret it must change nothing.
  assert.equal(connectorKey({ GOOGLE_APPS_SCRIPT_SECRET: "bridge-secret" }), null);
  assert.deepEqual(connectorKey({ GOOGLE_APPS_SCRIPT_SECRET: "bridge-secret", STORAGE_APPS_SCRIPT_SECRET: "storage-secret" }), KEY);
});

test("a seal opens only with its key, its type, and before it expires", () => {
  const t = seal(KEY, { typ: "access", sub: "u1", em: "o@x", aud: "https://s/api/mcp", scope: "s", iat: 1, exp: nowS() + 60 });
  assert.equal(unseal<AccessClaims>(KEY, t, "access")?.sub, "u1");
  assert.equal(unseal(OTHER, t, "access"), null, "a rotated key cuts every token");
  assert.equal(unseal(KEY, t, "refresh"), null, "type confusion refused");
  assert.equal(unseal(KEY, t, "access", nowS() + 120), null, "expired");
  // Tampering with the claims breaks the MAC.
  const [body, mac] = t.split(".");
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), em: "evil@x" })).toString("base64url");
  assert.equal(unseal(KEY, `${forged}.${mac}`, "access"), null);
  for (const junk of ["", ".", "a.b", `${body}.${mac}.x`, "not a token"]) assert.equal(unseal(KEY, junk, "access"), null);
});

test("a client id is its own registration; the secret is derived from it", () => {
  const id = seal(KEY, { typ: "client", uris: ["https://claude.ai/api/mcp/auth_callback"], name: "Claude", auth: "client_secret_post", iat: 1 });
  assert.deepEqual(openClient(KEY, id)?.uris, ["https://claude.ai/api/mcp/auth_callback"]);
  assert.equal(openClient(OTHER, id), null);
  assert.equal(openClient(KEY, seal(KEY, { typ: "client", uris: [], name: "", auth: "none", iat: 1 })), null, "no redirect, no client");
  assert.equal(clientSecretFor(KEY, id), clientSecretFor(KEY, id));
  assert.notEqual(clientSecretFor(KEY, id), clientSecretFor(KEY, id + "x"));
  assert.equal(clientHash(id).length, 22);
});

test("codes go only to Claude's callback or a loopback port", () => {
  assert.ok(redirectAllowed("https://claude.ai/api/mcp/auth_callback"));
  assert.ok(redirectAllowed("https://claude.com/api/mcp/auth_callback"));
  assert.ok(redirectAllowed("http://localhost:53682/callback"));
  assert.ok(redirectAllowed("http://127.0.0.1:9999/cb"));
  for (const bad of [
    "http://claude.ai/api/mcp/auth_callback",     // not https
    "https://claude.ai.evil.com/cb",              // look-alike host
    "https://evil.com/cb",
    "https://claude.ai/cb#frag",
    "https://user:pw@claude.ai/cb",
    "https://localhost/cb",                       // loopback must be http (RFC 8252)
    "javascript:alert(1)",
    "not a url",
  ]) assert.equal(redirectAllowed(bad), false, bad);
});

test("a loopback redirect may change port, nothing else may change", () => {
  const reg = ["http://localhost:4000/callback", "https://claude.ai/api/mcp/auth_callback"];
  assert.ok(redirectMatches(reg, "http://localhost:51234/callback"));
  assert.ok(redirectMatches(reg, "https://claude.ai/api/mcp/auth_callback"));
  assert.equal(redirectMatches(reg, "http://localhost:51234/other"), false);
  assert.equal(redirectMatches(reg, "http://127.0.0.1:4000/callback"), false);
  assert.equal(redirectMatches(reg, "https://claude.ai/api/mcp/auth_callback?x=1"), false);
});

test("PKCE: S256 of the verifier, nothing else", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  assert.ok(pkceOk(verifier, challenge));
  assert.equal(pkceOk(verifier, verifier), false, "plain refused");
  assert.equal(pkceOk("short", createHash("sha256").update("short").digest("base64url")), false);
  assert.equal(pkceOk("", ""), false);
});

test("the full handshake: code → tokens → refresh", () => {
  const clientId = seal(KEY, { typ: "client", uris: ["https://claude.ai/api/mcp/auth_callback"], name: "Claude", auth: "none", iat: 1 });
  const aud = "https://itqan-taupe.vercel.app/api/mcp";
  const code = seal(KEY, { typ: "code", cid: clientHash(clientId), ru: "https://claude.ai/api/mcp/auth_callback", cc: "c", sub: "u", em: "o@x", aud, exp: nowS() + 300, n: "n" });
  const c = unseal<CodeClaims>(KEY, code, "code")!;
  assert.equal(c.cid, clientHash(clientId));
  assert.equal(unseal(KEY, code, "access"), null, "a code is not an access token");

  const out = issueTokens(KEY, { sub: c.sub, em: c.em, aud, cid: c.cid });
  assert.equal(out.token_type, "Bearer");
  const acc = unseal<AccessClaims>(KEY, out.access_token, "access")!;
  assert.equal(acc.aud, aud);
  assert.equal(acc.exp - acc.iat, 3600);
  const ref = unseal<RefreshClaims>(KEY, out.refresh_token, "refresh")!;
  assert.equal(ref.cid, c.cid);
  assert.equal(unseal(KEY, out.refresh_token, "access"), null, "a refresh token is not an access token");
});

/* ------------------------------- JSON-RPC --------------------------------- */

const calls: [string, Record<string, unknown>][] = [];
const spec: ServerSpec = {
  name: "itqan", version: "1.0.0", instructions: "read-only",
  tools: [{ name: "echo", description: "echo", inputSchema: { type: "object" } }],
  run: async (name, args) => {
    calls.push([name, args]);
    if (args.fail) return { error: "nope" };
    if (args.throw) throw new Error("boom");
    return { got: args };
  },
};

test("initialize negotiates the version and names the server", async () => {
  const r = await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }, spec);
  assert.ok(r && "result" in r);
  const res = r.result as Record<string, unknown>;
  assert.equal(res.protocolVersion, "2025-03-26");
  assert.deepEqual(res.serverInfo, { name: "itqan", version: "1.0.0" });
  assert.deepEqual(res.capabilities, { tools: { listChanged: false } });
  assert.equal(negotiateVersion("1999-01-01"), "2025-06-18");
});

test("notifications get no answer; unknown methods get -32601", async () => {
  assert.equal(await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, spec), null);
  const r = await handleRpc({ jsonrpc: "2.0", id: "x", method: "resources/list" }, spec);
  assert.ok(r && "error" in r && r.error.code === -32601 && r.id === "x");
  const bad = await handleRpc({ id: 2, method: "ping" }, spec);
  assert.ok(bad && "error" in bad && bad.error.code === -32600);
  const ping = await handleRpc({ jsonrpc: "2.0", id: 3, method: "ping" }, spec);
  assert.ok(ping && "result" in ping);
});

test("tools/list and tools/call", async () => {
  const list = await handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, spec);
  assert.ok(list && "result" in list);
  assert.deepEqual((list.result as { tools: { name: string }[] }).tools.map((t) => t.name), ["echo"]);

  const ok = await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "echo", arguments: { a: 1 } } }, spec);
  assert.ok(ok && "result" in ok);
  const res = ok.result as { content: { type: string; text: string }[]; isError: boolean };
  assert.equal(res.isError, false);
  assert.deepEqual(JSON.parse(res.content[0].text), { got: { a: 1 } });

  const failed = await handleRpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { fail: true } } }, spec);
  assert.equal((failed as { result: { isError: boolean } }).result.isError, true);
  const threw = await handleRpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "echo", arguments: { throw: true } } }, spec);
  assert.match((threw as { result: { content: { text: string }[] } }).result.content[0].text, /boom/);

  const unknown = await handleRpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "write_sheet" } }, spec);
  assert.ok(unknown && "error" in unknown && unknown.error.code === -32602);
  assert.equal(calls.some(([n]) => n === "write_sheet"), false, "an unlisted tool never reaches the runner");
});

test("a huge answer is cut, and says so", () => {
  const { text } = toolText({ rows: "x".repeat(MAX_TEXT + 10) });
  assert.ok(text.length < MAX_TEXT + 200);
  assert.match(text, /cut at/);
});
