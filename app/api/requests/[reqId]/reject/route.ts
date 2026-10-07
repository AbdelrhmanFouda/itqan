import { NextRequest, NextResponse } from "next/server";
import { expectSupported, updateRecord } from "@/lib/sheets";
import { requireRole } from "@/lib/api-guard";
import { loadRequests } from "@/lib/customer-requests-data";
import { cairoStamp, NOTE_MAX, reqIdKey, requestStateToSheet } from "@/lib/customer-requests";

/**
 * «رفض» — the request is answered, and nothing is created.
 *
 * The REASON is required, server-side as well as on the screen, because the
 * customer reads it verbatim on their own card. A rejection with no reason is
 * the thing that makes a buyer telephone, which is exactly what the portal
 * exists to save.
 *
 * No row is created and nothing is deleted: the request keeps its place in the
 * tab with «مرفوض», the reason, who decided and when. One write, guarded by
 * `expect` on the reference number (an older bridge gets the fresh-read check
 * instead), so a row that moved is refused rather than mis-stamped.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ reqId: string }> }) {
  const g = await requireRole(req, ["production", "sales"]);
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
  const why = String(b.reason ?? "").trim().slice(0, NOTE_MAX);
  if (!why) return bad("missing_reason");

  try {
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
    // An accepted request has a work order against it — refusing it now is a
    // conversation with the customer, not a button.
    if (row.state !== "pending") return bad("not_pending", 409);

    const res = await updateRecord(
      "customerRequests",
      row.row,
      {
        state: requestStateToSheet("rejected"),
        rejectReason: why,
        decidedBy: g.user.email,
        decidedAt: cairoStamp(),
      },
      canExpect ? { expect: { field: "reqId", value: row.reqId } } : {},
    );
    if (!res.ok && res.reason === "row_changed") return bad("row_changed", 409);
    if (!res.ok) {
      console.error(`[requests/reject] ${want}: ${res.reason}`);
      return NextResponse.json({ ok: false, reason: "save_failed" }, { status: 503 });
    }
    return NextResponse.json({ ok: true, reqId: row.reqId });
  } catch (err) {
    console.error("[requests/reject]", err);
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}
