import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-guard";
import { isOwnerEmail } from "@/lib/roles";
import {
  connectorKey, seal, nowS, openClient, clientHash, redirectAllowed, redirectMatches,
  originFrom, resourceOf, CODE_TTL_S,
} from "@/lib/mcp-auth";
import { randomBytes } from "node:crypto";

/**
 * The owner's «allow Claude» on /connect/claude (2026-09-28).
 *
 * The page signs the owner in with the site's own Firebase login and posts
 * the OAuth request here with the ID token. `check` answers who is asking;
 * `approve` seals a five-minute one-time code for Claude's callback; `deny`
 * sends Claude the refusal. Every branch verifies the client and its redirect
 * URI BEFORE handing a URL back, so the page never navigates anywhere this
 * route has not vetted.
 *
 * Owner only: requireRole(req, []) admits owner + manager, and the email
 * check below narrows that to the owner — the connector reads client names,
 * orders and stock, and a manager's access could not be re-checked later
 * (the token carries no Firebase session to ask with).
 */
export async function POST(req: NextRequest) {
  const g = await requireRole(req, []);
  if ("deny" in g) return g.deny;
  if (!isOwnerEmail(g.user.email)) return NextResponse.json({ ok: false, error: "owner_only" }, { status: 403 });

  const key = connectorKey();
  if (!key) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const s = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : "");
  const action = s("action");

  const client = openClient(key, s("client_id"));
  if (!client) return fail("bad_client");
  const redirect = s("redirect_uri");
  if (!redirectAllowed(redirect) || !redirectMatches(client.uris, redirect)) return fail("bad_redirect");

  if (action === "check") {
    return NextResponse.json({ ok: true, clientName: client.name, redirectHost: new URL(redirect).host });
  }

  const origin = originFrom(req.headers, req.nextUrl.origin);
  const to = new URL(redirect);
  if (s("state")) to.searchParams.set("state", s("state"));
  to.searchParams.set("iss", origin);

  if (action === "deny") {
    to.searchParams.set("error", "access_denied");
    return NextResponse.json({ ok: true, redirect: to.toString() });
  }
  if (action !== "approve") return fail("bad_action");

  if (s("response_type") !== "code") return fail("unsupported_response_type");
  if (s("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(s("code_challenge"))) return fail("pkce_required");

  const code = seal(key, {
    typ: "code",
    cid: clientHash(s("client_id")),
    ru: redirect,
    cc: s("code_challenge"),
    sub: g.user.uid,
    em: g.user.email,
    aud: resourceOf(origin),
    exp: nowS() + CODE_TTL_S,
    n: randomBytes(9).toString("base64url"),
  });
  to.searchParams.set("code", code);
  return NextResponse.json({ ok: true, redirect: to.toString() });
}

function fail(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}
