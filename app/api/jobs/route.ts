import { NextRequest, NextResponse } from "next/server";
import { loadJobs } from "@/lib/jobs";
import { requireRole } from "@/lib/api-guard";
// The row this route writes is built by lib/work-orders-write.ts since
// 2026-09-23 — the customer portal's approval screen creates the SAME row from
// the same code, so there is one reading of every refusal instead of two.
import { createWorkOrder, sheetDeps } from "@/lib/work-orders-write";

// Jobs live in the sheet's `jobs` tab (they used to be in Firestore).
// GET returns jobs with auto-computed production progress.
//
// The GET is GUARDED (any approved role) since 2026-08-28: every job row names
// the CLIENT and the ordered quantity — the order book, not an operational
// read like runs/machines. It sat open while the doc line listing the open
// reads never included it.

export async function GET(req: NextRequest) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  try {
    // The list shows produced / remaining but no downtime, so «التوقفات» and
    // the Firestore open-event query are skipped here (2026-09-09, speed):
    // four bridge tabs instead of five on a cold instance. The detail route
    // still joins downtime for its runs table.
    const { jobs, writable, configured, duplicates, readAt } = await loadJobs({ downtime: false });
    return NextResponse.json({
      jobs, writable, configured, duplicates,
      // How old the numbers are: a served copy keeps its read time. The page
      // says «البيانات من قبل X» past a minute and refetches once on its own,
      // because the server has already started refreshing the copy.
      meta: { dataAgeMs: Math.max(0, Date.now() - readAt) },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ jobs: [], writable: false, configured: false, duplicates: [], meta: { dataAgeMs: 0 } });
  }
}


/**
 * A new work order. Since 2026-09-13 the person picks four things — the
 * product (from «الرئيسي»), the kilograms, the start date and the due date —
 * and Master supplies the rest: the client, the mould number and, when its
 * tonnage names exactly one machine, the machine. Owner's words: "all the data
 * that is in the master sheet to be from the master and no need to write it
 * again". Nothing a person could mistype is asked for.
 *
 * Still refused — the page makes each impossible before it can be sent:
 *  - a product that is not a Master name (re-checked on a fresh read on a miss);
 *  - a quantity that is not a plain number of kilograms («3.1طن»);
 *  - no due date, or a start date that is not a date;
 *  - a TYPED code the tab already holds (a blank code gets the next free
 *    «Job n», lib/work-orders.ts suggestJobCode) — checked on a fresh read;
 *  - a machine, when one IS sent, that is not a registry label.
 */
export async function POST(req: NextRequest) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const s = (k: string) => String(b[k] ?? "").trim();

    const out = await createWorkOrder({
      product: s("product"),
      masterRow: Number(b.masterRow) > 0 ? Number(b.masterRow) : undefined,
      qty: s("qtyOrdered") || s("qty"),
      startDate: s("startDate"),
      dueDate: s("dueDate"),
      code: s("code"),
      codeAuto: b.codeAuto === true,
      status: s("status"),
      priority: s("priority"),
      machine: s("machine"),
      client: s("client"),
      materialIssued: s("materialIssued"),
      masterbatch: s("masterbatch"),
      instructions: s("instructions"),
      notes: s("notes"),
    }, sheetDeps);

    if (!out.ok) return NextResponse.json({ ok: false, reason: out.reason }, { status: out.status });
    if (out.kind === "replay") return NextResponse.json({ ok: true, code: out.code, replay: true });
    // The bridge is at-least-once: a non-ok answer may sit on top of a row
    // that DID land. The page reloads the list before letting anyone retry.
    return NextResponse.json({ ...out.res, code: out.code }, { status: out.res.ok ? 200 : 400 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}
