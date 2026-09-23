import { NextRequest, NextResponse } from "next/server";
import { requireCustomerAccount } from "@/lib/api-guard";

/**
 * Who the portal is talking to — the ONE route that answers a customer whose
 * account is not (or no longer) approved.
 *
 * `requireCustomerAccount` admits any status, so a pending account meets the
 * waiting card and a revoked one meets the closed-account card instead of a
 * 401 page. It carries NO factory data: the status, the person's own name and
 * email, and the NAMES of the client rows they are linked to — which is the
 * one thing they need to see to know the owner linked the right company.
 * Deliberately not the client numbers, not the aliases, not anything else on
 * the document.
 *
 * Never cached: the link and the status are the access boundary, and a
 * revocation must show on the very next call.
 */
export async function GET(req: NextRequest) {
  const g = await requireCustomerAccount(req);
  if ("deny" in g) return g.deny;
  const c = g.customer;
  return NextResponse.json(
    {
      ok: true,
      status: c.status,
      displayName: c.displayName,
      email: c.email,
      requestedClient: c.requestedClient,
      clients: c.clients.map((x) => ({ name: x.name })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
