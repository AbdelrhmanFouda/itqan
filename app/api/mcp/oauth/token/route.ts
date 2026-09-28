import { NextRequest, NextResponse } from "next/server";
import {
  connectorKey, unseal, openClient, clientHash, clientSecretFor, sameSecret, pkceOk,
  issueTokens, originFrom, resourceOf, type CodeClaims, type RefreshClaims,
} from "@/lib/mcp-auth";
import { isOwnerEmail } from "@/lib/roles";

/**
 * OAuth token endpoint for the Claude connector (RFC 6749 + PKCE).
 *
 *   authorization_code → the code the owner's approval sealed, checked against
 *                        its client, redirect URI and PKCE verifier
 *   refresh_token      → a new pair while the refresh token lives (30 days)
 *
 * Both re-check that the identity is still the owner's email, so moving the
 * owner address in lib/roles.ts ends every connection at the next refresh.
 */
export async function POST(req: NextRequest) {
  const key = connectorKey();
  if (!key) return err("temporarily_unavailable", "connector not configured", 503);

  const p = await params(req);
  const origin = originFrom(req.headers, req.nextUrl.origin);
  const aud = resourceOf(origin);

  // Client authentication: HTTP Basic, or client_id (+ client_secret) in the body.
  let clientId = p.get("client_id") || "";
  let secret = p.get("client_secret") || "";
  const basic = req.headers.get("authorization") || "";
  if (basic.startsWith("Basic ")) {
    const [id, s] = Buffer.from(basic.slice(6), "base64").toString("utf8").split(":");
    clientId = decodeURIComponent(id || "");
    secret = decodeURIComponent(s || "");
  }
  const client = openClient(key, clientId);
  if (!client) return err("invalid_client", "unknown client", 401);
  if (client.auth !== "none" && !sameSecret(secret, clientSecretFor(key, clientId))) {
    return err("invalid_client", "bad client secret", 401);
  }

  const grant = p.get("grant_type");
  if (grant === "authorization_code") {
    const code = unseal<CodeClaims>(key, p.get("code") || "", "code");
    if (!code) return err("invalid_grant", "code expired or not valid");
    if (code.cid !== clientHash(clientId)) return err("invalid_grant", "code was issued to another client");
    if (code.ru !== (p.get("redirect_uri") || "")) return err("invalid_grant", "redirect_uri mismatch");
    if (!pkceOk(p.get("code_verifier") || "", code.cc)) return err("invalid_grant", "PKCE verification failed");
    if (code.aud !== aud || !isOwnerEmail(code.em)) return err("invalid_grant", "not valid here");
    return ok(issueTokens(key, { sub: code.sub, em: code.em, aud, cid: code.cid }));
  }
  if (grant === "refresh_token") {
    const r = unseal<RefreshClaims>(key, p.get("refresh_token") || "", "refresh");
    if (!r || r.cid !== clientHash(clientId) || r.aud !== aud) return err("invalid_grant", "refresh token expired or not valid");
    if (!isOwnerEmail(r.em)) return err("invalid_grant", "access withdrawn");
    return ok(issueTokens(key, { sub: r.sub, em: r.em, aud, cid: r.cid }));
  }
  return err("unsupported_grant_type", "authorization_code or refresh_token");
}

async function params(req: NextRequest): Promise<URLSearchParams> {
  const type = req.headers.get("content-type") || "";
  const text = await req.text().catch(() => "");
  if (type.includes("application/json")) {
    try {
      const o = JSON.parse(text) as Record<string, unknown>;
      return new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v ?? "")]));
    } catch {
      return new URLSearchParams();
    }
  }
  return new URLSearchParams(text);
}

const noStore = { "Cache-Control": "no-store", Pragma: "no-cache" };

function ok(body: object) {
  return NextResponse.json(body, { headers: noStore });
}

function err(error: string, description: string, status = 400) {
  return NextResponse.json({ error, error_description: description }, { status, headers: noStore });
}
