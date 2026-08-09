/**
 * Server-side guard for API routes.
 *
 * Every MUTATING route (and the PII reads: clients, inquiries) verifies the
 * caller's Firebase ID token and granted role before doing anything — the
 * client-side role gating in the dashboard is UX, not security; these routes
 * are reachable directly on the public domain.
 *
 * Usage in a route handler:
 *   const g = await requireRole(req);                 // any APPROVED role
 *   const g = await requireRole(req, ["sales"]);      // sales (+ owner/manager)
 *   if ("deny" in g) return g.deny;
 *   // g.role is the verified role
 *
 * Owner + manager always pass. Pages attach the token via lib/authed-fetch.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyIdToken, roleFor } from "@/lib/agent-auth";
import { hasFullAccess, type Role } from "@/lib/roles";

export type Guard = { role: Role } | { deny: NextResponse };

export async function requireRole(req: NextRequest, allowed?: Role[]): Promise<Guard> {
  const h = req.headers.get("authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  let role: Role | null = null;
  try {
    role = await roleFor(await verifyIdToken(token)); // null unless approved
  } catch {
    role = null;
  }
  if (!role) {
    return { deny: NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 }) };
  }
  if (allowed && !allowed.includes(role) && !hasFullAccess(role)) {
    return { deny: NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 }) };
  }
  return { role };
}
