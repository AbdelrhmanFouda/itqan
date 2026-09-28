import { NextRequest, NextResponse } from "next/server";
import { originFrom, SCOPE } from "@/lib/mcp-auth";

/**
 * OAuth authorization-server metadata (RFC 8414) for the Claude connector.
 * The site is its own authorization server: /connect/claude signs the owner
 * in, /api/mcp/oauth/* do the rest (lib/mcp-auth.ts).
 */
export async function GET(req: NextRequest) {
  const origin = originFrom(req.headers, req.nextUrl.origin);
  return NextResponse.json(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/connect/claude`,
      token_endpoint: `${origin}/api/mcp/oauth/token`,
      registration_endpoint: `${origin}/api/mcp/oauth/register`,
      scopes_supported: [SCOPE],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
      authorization_response_iss_parameter_supported: true,
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
