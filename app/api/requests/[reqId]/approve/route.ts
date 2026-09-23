import { NextRequest, NextResponse } from "next/server";
import { expectSupported, updateRecord } from "@/lib/sheets";
import { requireRole } from "@/lib/api-guard";
import { ISO_DAY } from "@/lib/work-orders";
import { loadRequests } from "@/lib/customer-requests-data";
import {
  cairoStamp, jobMarker, NOTE_MAX, reqIdKey, requestStateToSheet,
} from "@/lib/customer-requests";
import { createWorkOrder, sheetDeps } from "@/lib/work-orders-write";

/**
 * «موافقة وإنشاء أمر العمل» — the one place a request becomes a work order.
 *
 * TWO writes, in two different tabs, over a bridge that is AT-LEAST-ONCE. That
 * is the whole difficulty, and the marker is the whole answer:
 *
 *  1. «أوامر العمل» gains an ordinary row, status «لم يبدأ», whose notes carry
 *     `[REQ-2026-0001]`. `planWorkOrder` looks for that marker on the fresh
 *     read it already does, so an attempt that LANDED but answered failed is
 *     recognised on the next tap and nothing is created twice.
 *  2. «طلبات العملاء» is stamped «مقبول» + the order's code + who decided +
 *     when, `expect`-guarded on the reference number so a row that moved under
 *     a colleague's insert answers instead of stamping somebody else's request.
 *
 * If step 2 fails after step 1 landed, the answer NAMES THE CODE
 * (`stamp_failed`) and the screen says «أمر العمل أُنشئ برقم … — اضغط مرة أخرى
 * لتسجيله على الطلب». The next tap finds the marker and only re-stamps. The one
 * thing this must never do is leave the operator guessing whether to retry.
 *
 * The kilograms, the start date and the due date come from the BODY, not from
 * the request row: they are editable on the preview on purpose. The kilograms
 * are derived from «الرئيسي»'s free-text weight cell, and this screen is the
 * last place a mis-parsed standard can be caught before material is bought.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ reqId: string }> }) {
  const g = await requireRole(req, ["sales"]);
  if ("deny" in g) return g.deny;
  const bad = (reason: string, status = 400, extra: Record<string, unknown> = {}) =>
    NextResponse.json({ ok: false, reason, ...extra }, { status });

  const { reqId } = await params;
  const want = reqIdKey(reqId);
  if (!want) return bad("bad_request");

  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return bad("bad_request");
  }
  const s = (k: string) => String(b[k] ?? "").trim();
  const startDate = s("startDate");
  const dueDate = s("dueDate");
  if (!ISO_DAY.test(dueDate)) return bad("missing_due");
  if (startDate && !ISO_DAY.test(startDate)) return bad("bad_start");

  try {
    // The request row, as it is right now. A fresh read also makes the
    // fallback identity check honest on a bridge with no `expect`.
    const canExpect = await expectSupported();
    const { rows } = await loadRequests({ fresh: true });
    // A reference number the tab holds TWICE cannot be addressed: `find` takes
    // the first match and the `expect` guard passes on the wrong twin just as
    // happily, so a decision would land on the other customer's row. The
    // number is issued from a read with no lock — the same shape that put
    // ITQ0030 in «سحب» twice — so refuse rather than guess (owner fixes it in
    // the sheet, exactly as the storage page already asks).
    const hits = rows.filter((r) => r.reqId === want);
    if (hits.length > 1) return bad("duplicate_ref", 409);
    const row = hits[0];
    if (!row) return bad("not_found", 404);
    // Cancelled by the customer, or already decided — never silently redone.
    // `accepted` is allowed through: that is the re-stamp path, and the marker
    // check below stops it creating a second order.
    if (row.state !== "pending" && row.state !== "accepted") return bad("not_pending", 409);

    const out = await createWorkOrder({
      product: row.product,
      masterRow: Number(b.masterRow) > 0 ? Number(b.masterRow) : undefined,
      qty: s("qtyKg"),
      startDate,
      dueDate,
      status: "Not Started",
      // The customer's own words travel with the order, behind the marker.
      notes: `${jobMarker(row.reqId)} ${row.note}`.trim().slice(0, NOTE_MAX),
      // «الرئيسي» holds two product names twice, one of them shared by two
      // different clients. This screen picks; it never guesses.
      requireUniqueProduct: true,
      reqId: row.reqId,
    }, sheetDeps);

    if (!out.ok) {
      return bad(out.reason, out.status, out.candidates ? { duplicates: out.candidates } : {});
    }
    // `replay` here means either the marker was already in the tab or the code
    // was — both mean the order exists and nothing more was written.
    const code = out.code;
    if (out.kind === "written" && !out.res.ok) {
      console.error(`[requests/approve] append failed: ${out.res.reason}`);
      // The bridge is at-least-once: this may have landed anyway. The page
      // reloads the queue before it will let anyone tap again, and the next
      // tap finds the marker.
      return NextResponse.json({ ok: false, reason: "order_failed" }, { status: 503 });
    }

    const stamp = await updateRecord(
      "customerRequests",
      row.row,
      {
        state: requestStateToSheet("accepted"),
        jobCode: code,
        decidedBy: g.user.email,
        decidedAt: cairoStamp(),
      },
      canExpect ? { expect: { field: "reqId", value: row.reqId } } : {},
    );
    if (!stamp.ok) {
      console.error(`[requests/approve] stamp failed for ${want}: ${stamp.reason}`);
      // The order EXISTS. Say its number, so the next tap is a re-stamp and
      // not a second order — and so nobody creates one by hand in the sheet.
      return NextResponse.json({ ok: false, reason: "stamp_failed", code }, { status: 409 });
    }

    return NextResponse.json({ ok: true, code, created: out.kind === "written" });
  } catch (err) {
    console.error("[requests/approve]", err);
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}
