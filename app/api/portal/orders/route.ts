import { NextRequest, NextResponse } from "next/server";
import { loadJobs } from "@/lib/jobs";
import { requireCustomer } from "@/lib/api-guard";
import { belongsToCustomer } from "@/lib/customer-link";
import { loadRequests, ownRequests, toPortalRequest } from "@/lib/customer-requests-data";
import { piecesForKg, portalOrder, portalOrderStatus, reqIdFromNotes } from "@/lib/customer-requests";

/**
 * Everything this customer may see: their requests and their work orders.
 *
 * Two filters, both SERVER-SIDE and both on the client link that the guard
 * read off `customers/{uid}` — never on anything in the request, because no
 * portal route accepts a client name and there is therefore nothing to tamper
 * with. «طلبات العملاء»!D for the requests and **«أوامر العمل»!C for the
 * orders**: deliberately not Master's client for the product, because a
 * product name that exists on two Master rows would otherwise pull a
 * competitor's order into the answer. The failure mode is fail-CLOSED — an
 * order whose client cell is misspelled is missing, not leaked, and the owner
 * fixes it with an alias.
 *
 * The response carries the two whitelists from lib/customer-requests.ts and
 * nothing else. Every other field on a job row — machine and last machine,
 * mould number and code, material, masterbatch, piece weight, cavities, cycle
 * time, scrap, downtime, operator, priority, the internal notes, the produced
 * count and the percentage — stays on the server. tests/customer-requests.test.ts
 * pins the exact key sets, so nothing can ride along on the back of a later
 * change to `loadJobs`.
 *
 * `loadJobs` is asked for the order book only (no production join, no downtime,
 * no registry): two tabs instead of five, and none of what it would compute is
 * on the wire anyway.
 */
export async function GET(req: NextRequest) {
  const g = await requireCustomer(req);
  if ("deny" in g) return g.deny;
  const keys = g.customer.clientKeys;
  try {
    const [reqRead, jobsRead] = await Promise.all([
      loadRequests(),
      loadJobs({ production: false, downtime: false, machines: false }),
    ]);

    const requests = ownRequests(reqRead.rows, keys).map(toPortalRequest);

    const orders = jobsRead.jobs
      .filter((j) => belongsToCustomer(j.client, keys))
      .map((j) =>
        portalOrder({
          code: j.code,
          product: j.product,
          qtyKg: j.qtyOrderedKg,
          // ONE rule, both ways round: `piecesForKg` returns null unless BOTH
          // the piece weight and the kilograms are above zero. The shortcut
          // that used to sit here trusted `qtyOrdered` whenever Master had a
          // weight — but lib/jobs.ts sets it to 0 when «الكمية المطلوبة» is
          // unreadable («3.1طن» was live until 13 Sep), so a row with a
          // readable weight and an unreadable quantity told the buyer
          // «المطلوب: 0 قطعة». A wrong number is worse than none on the screen
          // they read instead of phoning.
          qtyPieces: piecesForKg(j.qtyOrderedKg, j.pieceWeightG),
          startDate: j.startDate,
          dueDate: j.dueDate,
          status: portalOrderStatus(j.status, j.open),
          reqId: reqIdFromNotes(j.notes),
        }),
      );

    // The OLDEST answer behind these numbers. A copy of any age up to the
    // stale window is served at once and refreshed behind, so the page says
    // how old it is and refetches twice rather than pretending to be live.
    const readAt = Math.min(reqRead.readAt, jobsRead.readAt);
    return NextResponse.json(
      { ok: true, requests, orders, meta: { dataAgeMs: Math.max(0, Date.now() - readAt) } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[portal/orders]", err);
    return NextResponse.json({ ok: false, error: "read_failed" }, { status: 503 });
  }
}
