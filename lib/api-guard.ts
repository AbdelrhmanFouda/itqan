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
import { verifyIdToken, roleFor, lookupCustomer, type VerifiedUser } from "@/lib/agent-auth";
import { hasFullAccess, type Role } from "@/lib/roles";
import { clientKeysOf, type ClientLink, type CustomerStatus } from "@/lib/customer-link";

// `user` carries the VERIFIED identity from the ID token — added so a route can
// record who did something (downtimeEvents.createdBy) without trusting a name
// posted in the body. Existing callers read only `g.role` and are unaffected.
export type Guard = { role: Role; user: VerifiedUser } | { deny: NextResponse };

export async function requireRole(req: NextRequest, allowed?: Role[]): Promise<Guard> {
  const h = req.headers.get("authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  let role: Role | null = null;
  let user: VerifiedUser | null = null;
  try {
    user = await verifyIdToken(token);
    // The token MUST be passed on: the role lookup reads the caller's own
    // profile as the caller. Without it every non-owner resolves to null.
    role = await roleFor(user, token); // null unless approved
  } catch {
    role = null;
    user = null;
  }
  if (!role || !user) {
    return { deny: NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 }) };
  }
  if (allowed && !allowed.includes(role) && !hasFullAccess(role)) {
    return { deny: NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 }) };
  }
  return { role, user };
}

/* ------------------------------ the customer ------------------------------ */

/**
 * The customer guards — the portal's whole security boundary.
 *
 * A customer is an ACCOUNT KIND, not a role (lib/customer-link.ts says why),
 * so `requireRole` already refuses them: they hold no role and `lookupRole`
 * returns null. These two are the mirror image — they admit ONLY an account
 * with a `customers/{uid}` document, so owner, manager and every staff role
 * are refused here by the same property, in the same direction.
 *
 * ⚠ The client link comes from the DOCUMENT, never from the request. No portal
 * route accepts a client name in a body or a query string, so there is nothing
 * to tamper with and nothing for a future route to forget to check. Do not add
 * a `client` parameter to any of them.
 */
export type { ClientLink };

export type CustomerIdentity = {
  uid: string;
  email: string;
  status: CustomerStatus;
  displayName: string;
  requestedClient: string;
  clients: ClientLink[];
  /** Every «العملاء» spelling this account answers to — exact keys, "" excluded. */
  clientKeys: Set<string>;
};

export type CustomerGuard = { customer: CustomerIdentity } | { deny: NextResponse };

const unauthorized = () =>
  NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

/** Verify the token and read the caller's own customer document. */
async function customerFor(req: NextRequest): Promise<CustomerGuard> {
  const h = req.headers.get("authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  let user: VerifiedUser | null = null;
  try {
    user = await verifyIdToken(token);
  } catch {
    return { deny: unauthorized() };
  }
  const account = await lookupCustomer(user, token);
  if (!account) return { deny: unauthorized() }; // staff, or no document at all
  return {
    customer: {
      uid: account.uid,
      email: account.email,
      status: account.status,
      displayName: account.displayName,
      requestedClient: account.requestedClient,
      clients: account.clients,
      clientKeys: clientKeysOf(account.clients),
    },
  };
}

/**
 * Any customer account, whatever its status — `/api/portal/me` alone.
 *
 * A pending or revoked customer must meet a CARD that explains itself, not a
 * 401 page: this is the one call that answers them, so the portal can render
 * «في انتظار الموافقة» or «تم إيقاف هذا الحساب». It carries no factory data.
 */
export async function requireCustomerAccount(req: NextRequest): Promise<CustomerGuard> {
  return customerFor(req);
}

/**
 * An APPROVED and LINKED customer — every route that serves factory data.
 *
 * Both conditions matter. Approved-but-unlinked has no `clientKeys`, so every
 * filter would match nothing; answering 401 instead of an empty list is the
 * honest reading, and it is also what makes a revoked account (status back to
 * pending AND clients cleared) lose its data the moment the owner taps «إيقاف».
 */
export async function requireCustomer(req: NextRequest): Promise<CustomerGuard> {
  const g = await customerFor(req);
  if ("deny" in g) return g;
  if (g.customer.status !== "approved" || g.customer.clients.length === 0) {
    return { deny: unauthorized() };
  }
  return g;
}
