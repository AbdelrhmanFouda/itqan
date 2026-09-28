import { NextRequest, NextResponse } from "next/server";
import { connectorKey, seal, nowS, redirectAllowed, clientSecretFor, SCOPE, type ClientAuth } from "@/lib/mcp-auth";

/**
 * OAuth dynamic client registration (RFC 7591) for the Claude connector.
 *
 * Claude registers itself before the first sign-in. Nothing is stored: the
 * client id IS the registration, sealed (lib/mcp-auth.ts). It grants nothing
 * on its own — a code still needs the owner to sign in and approve — and it
 * only accepts Claude's own callback or a loopback address, so a client
 * registered by anyone else has nowhere to send a code.
 */
export async function POST(req: NextRequest) {
  const key = connectorKey();
  if (!key) return NextResponse.json({ error: "temporarily_unavailable" }, { status: 503 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return bad("invalid_client_metadata", "body must be JSON");
  }
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === "string") : [];
  if (uris.length === 0 || uris.length > 10) return bad("invalid_redirect_uri", "one to ten redirect_uris");
  const refused = uris.find((u) => !redirectAllowed(u));
  if (refused) return bad("invalid_redirect_uri", `not allowed: ${refused}`);

  const asked = String(body.token_endpoint_auth_method || "none");
  const auth: ClientAuth = asked === "client_secret_post" || asked === "client_secret_basic" ? asked : "none";
  const name = String(body.client_name || "Claude").slice(0, 80);
  const iat = nowS();
  const clientId = seal(key, { typ: "client", uris, name, auth, iat });

  return NextResponse.json(
    {
      client_id: clientId,
      client_id_issued_at: iat,
      ...(auth === "none" ? {} : { client_secret: clientSecretFor(key, clientId), client_secret_expires_at: 0 }),
      client_name: name,
      redirect_uris: uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: auth,
      scope: SCOPE,
    },
    { status: 201 },
  );
}

function bad(error: string, description: string) {
  return NextResponse.json({ error, error_description: description }, { status: 400 });
}
