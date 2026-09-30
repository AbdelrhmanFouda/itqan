/**
 * The Claude connector's OAuth — stateless, signed, owner-only (2026-09-28).
 *
 * Claude (claude.ai, the desktop and phone apps, Claude Code) reaches the site
 * as a remote MCP server at /api/mcp. A connector added in claude.ai can only
 * authenticate through OAuth, so the site is its own small authorization
 * server: the owner signs in with Google on /connect/claude, approves, and
 * Claude receives a token that the MCP route verifies on every call.
 *
 * NOTHING IS STORED. There is no database for factory data and none is added
 * for this: every artefact — the registered client, the one-time code, the
 * access and refresh tokens — is a JSON claim set sealed with an HMAC. The
 * `typ` inside the seal is checked on every open, so a client id can never be
 * replayed as an access token, nor a refresh token as a code.
 *
 * The key is MCP_TOKEN_SECRET when set, else derived from the STORAGE bridge
 * secret under a fixed label — so the connector needs no new env var to work.
 * ⚠ NEVER from GOOGLE_APPS_SCRIPT_SECRET: that token is written in
 * apps-script.gs, and the GitHub repo was found PUBLIC on 2026-09-28, so a key
 * derived from it could be computed by anyone and every token forged. This
 * file is public too — the key must come from a value that is only in env.
 * **To cut every connected Claude off at once, set MCP_TOKEN_SECRET to a new
 * random value in Vercel and redeploy.**
 *
 * Pure apart from node:crypto — no "@/" imports, so tests/mcp.test.ts can load
 * it directly.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SCOPE = "itqan.read";
export const CODE_TTL_S = 5 * 60;
export const ACCESS_TTL_S = 60 * 60;
export const REFRESH_TTL_S = 30 * 24 * 60 * 60;

/** Where a code may be sent: Claude's own callback, or a loopback port
 *  (Claude Code opens one on the laptop). Anything else is refused at
 *  registration AND at authorization, so a stranger who registers a client
 *  cannot phish a code out of the owner with a link to their own server. */
const CLAUDE_HOSTS = new Set(["claude.ai", "claude.com"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type ClientAuth = "none" | "client_secret_post" | "client_secret_basic";

export type ClientClaims = { typ: "client"; uris: string[]; name: string; auth: ClientAuth; iat: number };
export type CodeClaims = {
  typ: "code"; cid: string; ru: string; cc: string;
  sub: string; em: string; aud: string; exp: number; n: string;
};
export type AccessClaims = { typ: "access"; sub: string; em: string; aud: string; scope: string; iat: number; exp: number };
export type RefreshClaims = { typ: "refresh"; sub: string; em: string; aud: string; cid: string; iat: number; exp: number };
type Claims = ClientClaims | CodeClaims | AccessClaims | RefreshClaims;

export const nowS = (ms: number = Date.now()) => Math.floor(ms / 1000);

/** The signing key, or null when the site has neither secret (connector off). */
export function connectorKey(env: Record<string, string | undefined> = process.env): Buffer | null {
  const own = (env.MCP_TOKEN_SECRET || "").trim();
  if (own) return createHmac("sha256", own).update("itqan-mcp-key").digest();
  // The storage token lives only in env and in the storage sheet's own script,
  // never in this repo (checked 2026-09-30). The main bridge's does not qualify.
  const base = (env.STORAGE_APPS_SCRIPT_SECRET || "").trim();
  if (!base) return null;
  return createHmac("sha256", base).update("itqan-mcp-connector-v2").digest();
}

const mac = (key: Buffer, body: string) => createHmac("sha256", key).update(body).digest();

export function seal(key: Buffer, claims: Claims): string {
  const body = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${body}.${mac(key, body).toString("base64url")}`;
}

/** The claims inside `token` when it is ours, of type `typ`, and unexpired. */
export function unseal<T extends Claims>(key: Buffer, token: string, typ: T["typ"], now = nowS()): T | null {
  const parts = String(token || "").split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const want = mac(key, parts[0]);
  const got = Buffer.from(parts[1], "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!claims || claims.typ !== typ) return null;
  if (typeof claims.exp === "number" && claims.exp < now) return null;
  return claims as T;
}

/** A client's secret is derived, never stored: HMAC of its own id. */
export function clientSecretFor(key: Buffer, clientId: string): string {
  return mac(key, `secret:${clientId}`).toString("base64url");
}

export function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** A short fingerprint of a client id, so a code does not carry the whole id. */
export function clientHash(clientId: string): string {
  return createHash("sha256").update(clientId).digest("base64url").slice(0, 22);
}

/** PKCE, S256 only (RFC 7636). The plain method is refused at authorization. */
export function pkceOk(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier || "")) return false;
  const got = createHash("sha256").update(verifier).digest("base64url");
  return sameSecret(got, challenge || "");
}

export function redirectAllowed(uri: string): boolean {
  let u: URL;
  try { u = new URL(uri); } catch { return false; }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === "https:" && CLAUDE_HOSTS.has(u.hostname)) return true;
  if (u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname)) return true;
  return false;
}

/** RFC 8252 §7.3: a loopback client may pick any port at run time, so the
 *  port is the one part of a loopback URI that is not compared. */
export function redirectMatches(registered: string[], uri: string): boolean {
  if (registered.includes(uri)) return true;
  let u: URL;
  try { u = new URL(uri); } catch { return false; }
  if (u.protocol !== "http:" || !LOOPBACK_HOSTS.has(u.hostname)) return false;
  return registered.some((r) => {
    try {
      const v = new URL(r);
      return v.protocol === "http:" && v.hostname === u.hostname && v.pathname === u.pathname && v.search === u.search;
    } catch { return false; }
  });
}

/** Parse and check a client id; null when it is not one we issued. */
export function openClient(key: Buffer, clientId: string): ClientClaims | null {
  const c = unseal<ClientClaims>(key, clientId, "client");
  return c && Array.isArray(c.uris) && c.uris.length > 0 ? c : null;
}

/** The token response for a verified identity (RFC 6749 §5.1). */
export function issueTokens(key: Buffer, who: { sub: string; em: string; aud: string; cid: string }, now = nowS()) {
  const access: AccessClaims = { typ: "access", sub: who.sub, em: who.em, aud: who.aud, scope: SCOPE, iat: now, exp: now + ACCESS_TTL_S };
  const refresh: RefreshClaims = { typ: "refresh", sub: who.sub, em: who.em, aud: who.aud, cid: who.cid, iat: now, exp: now + REFRESH_TTL_S };
  return {
    access_token: seal(key, access),
    token_type: "Bearer",
    expires_in: ACCESS_TTL_S,
    refresh_token: seal(key, refresh),
    scope: SCOPE,
  };
}

/** "https://host" from the request, behind Vercel's proxy. */
export function originFrom(headers: { get(name: string): string | null }, fallback: string): string {
  const fixed = (process.env.MCP_PUBLIC_ORIGIN || "").trim().replace(/\/+$/, "");
  if (fixed) return fixed;
  const host = headers.get("x-forwarded-host") || headers.get("host");
  if (!host) return fallback.replace(/\/+$/, "");
  const proto = (headers.get("x-forwarded-proto") || "").split(",")[0].trim()
    || (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

export const resourceOf = (origin: string) => `${origin}/api/mcp`;
