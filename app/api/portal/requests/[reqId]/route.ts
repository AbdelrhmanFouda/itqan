import { NextRequest, NextResponse } from "next/server";
import { expectSupported, updateRecord } from "@/lib/sheets";
import { requireCustomer } from "@/lib/api-guard";
import { loadRequests, ownRequests } from "@/lib/customer-requests-data";
import { isCancellable, reqIdKey, requestStateToSheet } from "@/lib/customer-requests";

/**
 * The customer withdraws a request — the one write they own.
 *
 * Only while «قيد المراجعة» (owner's decision 5). After approval there is a
 * real work order with material against it, and «أوامر العمل»!K has no
 * «ملغي» in its four validated values: a cancellation there is a phone call,
 * not a button. Editing is the same thing said differently — cancel and send
 * another, which is one tap more and never leaves a half-changed row.
 *
 * The row is addressed by its REFERENCE NUMBER, never by a row number the
 * phone is holding: a colleague inserting a row in the sheet moves every row
 * beneath it. It is re-found on a read, checked to belong to this account, and
 * the write itself carries `expect: {reqId}` so the bridge verifies the row's
 * identity atomically with the change (version 7) — the same two-path pattern
 * as PATCH /api/jobs/[id].
 *
 * ⚠ THE READ IS ALWAYS FRESH, `expect` or not. `expect` pins the row's
 * IDENTITY, never its STATE, so it cannot stand in for a fresh read here. It
 * used to skip the fresh read whenever the bridge could check identity — which
 * on v7 and on the Sheets API transport is always, in production — so the
 * cancellable check was made against a copy that lib/sheets.ts may serve up to
 * the stale window old. Sales approves REQ-2026-0001 on one instance — a real
 * «أوامر العمل» row, material reserved on /dashboard/stock — and within that
 * window the customer's phone, still painting the pre-approval list, taps
 * «إلغاء» on another instance: the state read `pending`, the reqId cell had
 * not moved so `expect` passed, and «مقبول» became «ألغاه العميل» on a row
 * that still carried its jobCode while the order stayed open. Nothing on
 * either screen could repair it — approve answers `not_pending` afterwards.
 * Both staff writes read fresh for exactly this reason (approve, reject).
 *
 * `jobCode` is the second, STATE-INDEPENDENT lock: a request that has a work
 * order against it is not a request any more, whatever its state cell says.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ reqId: string }> }) {
  const g = await requireCustomer(req);
  if ("deny" in g) return g.deny;
  const bad = (reason: string, status = 400) => NextResponse.json({ ok: false, reason }, { status });

  const { reqId } = await params;
  const want = reqIdKey(reqId);
  if (!want) return bad("bad_request");

  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return bad("bad_request");
  }
  // One action exists. Anything else is refused rather than ignored, so a
  // future action cannot arrive here and quietly do nothing.
  if (String(b.action ?? "") !== "cancel") return bad("bad_action");

  try {
    const canExpect = await expectSupported();
    const { rows } = await loadRequests({ fresh: true });
    const mine = ownRequests(rows, g.customer.clientKeys);
    const hits = mine.filter((r) => r.reqId === want);
    // Two rows with one reference number: the tab was hand-edited, or two
    // submits landed in the same bridge round trip. Either way the row cannot
    // be addressed, and `expect` would pass on the wrong twin — so refuse
    // rather than cancel a request nobody can identify.
    if (hits.length > 1) return bad("duplicate_ref", 409);
    const row = hits[0];
    // Not theirs and does not exist are the same answer: guessing another
    // customer's reference number must tell the guesser nothing.
    if (!row) return bad("not_found", 404);
    if (!isCancellable(row.state) || row.jobCode) return bad("not_pending", 409);

    const res = await updateRecord(
      "customerRequests",
      row.row,
      { state: requestStateToSheet("cancelled") },
      canExpect ? { expect: { field: "reqId", value: row.reqId } } : {},
    );
    // The row moved between the read and the write — the bridge refused it,
    // which is exactly what it is for.
    if (!res.ok && res.reason === "row_changed") return bad("row_changed", 409);
    if (!res.ok) {
      console.error(`[portal/requests/${want}] cancel failed: ${res.reason}`);
      return NextResponse.json({ ok: false, reason: "save_failed" }, { status: 503 });
    }
    return NextResponse.json({ ok: true, reqId: row.reqId });
  } catch (err) {
    console.error("[portal/requests/cancel]", err);
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}
