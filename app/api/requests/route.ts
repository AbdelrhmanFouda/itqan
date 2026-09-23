import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-guard";
import { loadRequests } from "@/lib/customer-requests-data";

/**
 * «طلبات العملاء» as the factory sees it — the review queue.
 *
 * Sales, manager and the owner (owner's decision 6). Not production, not
 * quality, not the worker: a row here names a customer and turns into a real
 * work order with material bought against it, and the screen behind this route
 * is where that decision is made.
 *
 * Unlike the portal's own reads, NOTHING is filtered out: the staff side sees
 * every request from every customer, which is the whole point of a queue. The
 * filtering that matters is the other direction (a buyer sees only their own),
 * and it lives in the portal routes.
 *
 * Pending first, then newest first inside each half, so the thing waiting for
 * an answer is always at the top of the phone.
 */
export async function GET(req: NextRequest) {
  const g = await requireRole(req, ["sales"]);
  if ("deny" in g) return g.deny;
  try {
    const { rows, readAt } = await loadRequests();
    const requests = [...rows].sort((a, b) => {
      const pa = a.state === "pending" ? 0 : 1;
      const pb = b.state === "pending" ? 0 : 1;
      if (pa !== pb) return pa - pb;
      // «yyyy-mm-dd HH:MM» sorts correctly as text; the reference number is
      // the tie-break, so two requests submitted in the same minute still
      // have a stable order on every reload.
      if (a.submittedAt !== b.submittedAt) return a.submittedAt < b.submittedAt ? 1 : -1;
      return a.reqId < b.reqId ? 1 : -1;
    });
    return NextResponse.json(
      {
        ok: true,
        requests,
        pending: requests.filter((r) => r.state === "pending").length,
        // How old the numbers are — the same sentence the jobs page shows.
        meta: { dataAgeMs: Math.max(0, Date.now() - readAt) },
      },
      // The body names customers and quantities and is scoped to a signed-in
      // member of staff: never a shared cache.
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[requests]", err);
    return NextResponse.json({ ok: false, error: "read_failed" }, { status: 503 });
  }
}
