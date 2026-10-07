import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-guard";
import { todayIso } from "@/lib/dates";
import { loadRequests } from "@/lib/customer-requests-data";
import { reqIdKey } from "@/lib/customer-requests";
import { planWorkOrder, sheetDeps } from "@/lib/work-orders-write";

/**
 * What approving this request WOULD write — and nothing written.
 *
 * The preview is built by `planWorkOrder`, the same function the approval
 * itself calls a second later, so the screen cannot show one thing and the
 * sheet receive another. Everything it returns is editable on the screen
 * except the product: the kilograms above all, because they are derived from
 * «الرئيسي»'s free-text weight cell (which held «21.6 ALL pieces» until
 * 13 Sep 2026), and this is the last place a mis-parsed standard can be caught
 * before material is bought against it.
 *
 * `duplicates` is the one thing that stops the screen: «الرئيسي» holds two
 * product names twice, and one of those two is shared by two different
 * clients. The approver taps the right row and it comes back as `masterRow`.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ reqId: string }> }) {
  const g = await requireRole(req, ["production", "sales"]);
  if ("deny" in g) return g.deny;
  const { reqId } = await params;
  const want = reqIdKey(reqId);
  if (!want) return NextResponse.json({ ok: false, reason: "bad_request" }, { status: 400 });

  try {
    const { rows } = await loadRequests();
    const row = rows.find((r) => r.reqId === want);
    if (!row) return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });

    // The approver may have tapped a candidate already — re-preview with it.
    const picked = Number(req.nextUrl.searchParams.get("masterRow"));
    // A row typed or edited by hand in «طلبات العملاء» can carry no kilograms
    // at all, and the screen must ASK for them rather than refuse to open —
    // the «الكمية (كجم)» field the approver would use is inside the form that
    // only renders when the preview succeeds. `planWorkOrder` refuses a blank
    // quantity with `bad_qty` (it is the same function the WRITE calls, which
    // must refuse), so the plan is built against a placeholder and the answer
    // carries 0, which the screen renders as an empty, required field.
    const hasQty = row.qtyKg > 0;
    const planned = await planWorkOrder({
      product: row.product,
      masterRow: picked > 0 ? picked : undefined,
      // Master's derivation, shown so it can be corrected.
      qty: String(hasQty ? row.qtyKg : 1),
      startDate: todayIso(),
      // What they asked for. The approver counters here, and the portal shows
      // the customer both dates with theirs struck through.
      dueDate: row.wantedDate || todayIso(),
      status: "Not Started",
      requireUniqueProduct: true,
      reqId: row.reqId,
    }, sheetDeps);

    if (!planned.ok) {
      // `duplicate_product` is not a failure the approver caused — it is the
      // screen's next question, so the candidates travel with it.
      return NextResponse.json(
        { ok: false, reason: planned.reason, duplicates: planned.candidates ?? [], reqId: row.reqId },
        { status: planned.status, headers: { "Cache-Control": "no-store" } },
      );
    }

    const p = planned.plan;
    return NextResponse.json(
      {
        ok: true,
        reqId: row.reqId,
        state: row.state,
        // What the customer asked for, beside what the factory derived.
        qtyAsked: row.qtyAsked,
        unit: row.unit,
        wantedDate: row.wantedDate,
        note: row.note,
        client: p.client,
        // The «العملاء» spelling the request itself carries — it can differ
        // from Master's for the product, and the sheet's own «حالة الربط»
        // matches on Master's, which is why the order takes that one.
        requestClient: row.client,
        code: p.code,
        product: p.product,
        moldCode: p.moldCode,
        masterRow: p.masterRow,
        // 0 means «the request carries no quantity» — the form blanks the
        // field and `canApprove` stays false until the approver types one.
        qtyKg: hasQty ? p.qtyKg : 0,
        startDate: p.startDate,
        dueDate: p.dueDate,
        machine: p.machine,
        status: "Not Started",
        duplicates: p.candidates.length > 1 ? p.candidates : [],
        // Set when a previous attempt already created the order: the screen
        // says so and the next tap only stamps the request row.
        existingCode: p.markerCode,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[requests/preview]", err);
    return NextResponse.json({ ok: false, reason: "read_failed" }, { status: 503 });
  }
}
