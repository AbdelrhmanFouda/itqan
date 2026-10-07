import { NextRequest, NextResponse } from "next/server";
import { loadJobs, productKeyOf } from "@/lib/jobs";
import { requireCustomer } from "@/lib/api-guard";
import { belongsToCustomer } from "@/lib/customer-link";
import { attributeProduction } from "@/lib/customer-progress";
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
 * time, scrap, downtime, operator, priority, the internal notes, the staff
 * progress figures and the percentage — stays on the server.
 * tests/customer-requests.test.ts pins the exact key sets, so nothing can ride
 * along on the back of a later change to `loadJobs`.
 *
 * THE PRODUCED COUNT LEAVES since 2026-10-07 (owner's word, signed in as a
 * customer: "I only see my orders, not how many were made") — attributed and
 * client-filtered, never the staff figure. A job's own progress fields are by
 * product NAME alone with no client term and no end date; they are not read
 * here at all (tests/portal-access.test.ts pins that). `attributeProduction`
 * (lib/customer-progress.ts) is handed this customer's OWN orders and the
 * shift rows, and credits a row to an order only when the row's own «العميل»
 * cell is this customer's and its date falls inside that one order's window —
 * `null` where that cannot be said honestly, and the page then shows no
 * number. Scrap, the machine, the operator, downtime, rates, shift dates and
 * the staff percentage still never leave.
 *
 * `loadJobs` is asked for the order book and the shift log — no downtime, no
 * registry: three tabs instead of five (it was two before the count).
 */
export async function GET(req: NextRequest) {
  const g = await requireCustomer(req);
  if ("deny" in g) return g.deny;
  const keys = g.customer.clientKeys;
  try {
    const [reqRead, jobsRead] = await Promise.all([
      loadRequests(),
      loadJobs({ production: true, downtime: false, machines: false }),
    ]);

    const requests = ownRequests(reqRead.rows, keys).map(toPortalRequest);

    const own = jobsRead.jobs.filter((j) => belongsToCustomer(j.client, keys));

    // How many pieces were made for each of THIS customer's orders. Master's
    // client is read for one thing only: whether a shift row with a BLANK
    // client cell can belong to nobody else (the name is held once in
    // «الرئيسي», by this customer). The filter above stays on the order's own
    // client cell.
    const made = attributeProduction(
      own.map((j) => ({
        id: j.id,
        productKey: productKeyOf(j.product),
        startDate: j.startDate,
        uniqueOwner: !j.ambiguous && belongsToCustomer(j.masterClient, keys),
      })),
      jobsRead.productionRuns,
      keys,
    );
    // NO SHIFT ROWS AT ALL = THE LOG WAS NOT READ. lib/sheets.ts turns a failed
    // tab read into an EMPTY tab, never an error, so a bad moment at the bridge
    // arrives here as "nothing was ever made" — and every order would be sent a
    // real-looking zero: the running order's card would say «لم يُسجَّل إنتاج
    // بعد», the counts on the others would vanish, and the device would save
    // that answer and paint it first on the next visit. A factory's shift log
    // is never truly empty, so no number is sent instead (`?? null` below) and
    // the cards print nothing until the next read.
    if (jobsRead.productionRuns.length === 0) made.clear();

    const orders = own.map((j) =>
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
        produced: made.get(j.id) ?? null,
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
