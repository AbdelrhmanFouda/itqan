import { NextRequest, NextResponse } from "next/server";
import { originFrom, resourceOf, SCOPE } from "@/lib/mcp-auth";

/**
 * OAuth protected-resource metadata (RFC 9728) for the Claude connector.
 * Served at the root and at /api/mcp's suffix, since clients try both.
 * Public by nature — it names endpoints, never data.
 */
export async function GET(req: NextRequest) {
  const origin = originFrom(req.headers, req.nextUrl.origin);
  return NextResponse.json(
    {
      resource: resourceOf(origin),
      authorization_servers: [origin],
      scopes_supported: [SCOPE],
      bearer_methods_supported: ["header"],
      resource_name: "ITQAN factory data",
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
