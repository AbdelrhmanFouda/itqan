import { NextRequest, NextResponse } from "next/server";
import { connectorKey, unseal, originFrom, resourceOf, type AccessClaims } from "@/lib/mcp-auth";
import { handleRpc, type ServerSpec } from "@/lib/mcp-protocol";
import { MCP_TOOLS, MCP_INSTRUCTIONS, runMcpTool } from "@/lib/mcp-tools";
import { isOwnerEmail } from "@/lib/roles";

/**
 * The Claude connector — a remote MCP server (2026-09-28).
 *
 * Add https://itqan-taupe.vercel.app/api/mcp as a custom connector in Claude
 * (Settings → Connectors); Claude discovers the sign-in from the 401 below,
 * the owner approves on /connect/claude, and every call after that carries
 * the token lib/mcp-auth.ts sealed.
 *
 * OWNER ONLY and READ-ONLY. The token is checked for its signature, expiry
 * and this deployment's address, and its email must still be the owner's
 * (lib/roles.ts) on every call. The tools (lib/mcp-tools.ts) have no write.
 *
 * Only POST is served: Next answers 405 to a GET, which streamable-HTTP
 * clients read as "no server-initiated stream" — correct, there is none.
 */

const spec: ServerSpec = {
  name: "itqan",
  version: "1.0.0",
  instructions: MCP_INSTRUCTIONS,
  tools: MCP_TOOLS,
  run: runMcpTool,
};

function unauthorized(origin: string, why: string) {
  return NextResponse.json(
    { error: "invalid_token", error_description: why },
    {
      status: 401,
      headers: {
        "WWW-Authenticate":
          `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp", ` +
          `error="invalid_token", error_description="${why}"`,
      },
    },
  );
}

export async function POST(req: NextRequest) {
  const origin = originFrom(req.headers, req.nextUrl.origin);
  const key = connectorKey();
  if (!key) return NextResponse.json({ error: "connector_not_configured" }, { status: 503 });

  // The token FIRST — nothing in the body is read for a caller without one.
  const h = req.headers.get("authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!token) return unauthorized(origin, "sign in required");
  const claims = verifyConnectorToken(key, token, origin);
  if (!claims) return unauthorized(origin, "token expired or not valid here");

  let msg: unknown;
  try {
    msg = await req.json();
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }

  if (Array.isArray(msg)) {
    const out = (await Promise.all(msg.map((m) => handleRpc(m, spec)))).filter(Boolean);
    return out.length ? NextResponse.json(out) : new NextResponse(null, { status: 202 });
  }
  const res = await handleRpc(msg, spec);
  return res ? NextResponse.json(res) : new NextResponse(null, { status: 202 });
}

/** The sealed access token, for this deployment, still held by the owner. */
function verifyConnectorToken(key: Buffer, token: string, origin: string): AccessClaims | null {
  const c = unseal<AccessClaims>(key, token, "access");
  if (!c || c.aud !== resourceOf(origin)) return null;
  return isOwnerEmail(c.em) ? c : null;
}
