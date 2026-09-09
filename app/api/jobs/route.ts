import { NextRequest, NextResponse } from "next/server";
import { appendRecord, getRecords } from "@/lib/sheets";
import { loadJobs } from "@/lib/jobs";
import { requireRole } from "@/lib/api-guard";
import { isJobStatus, jobStatusToSheet, jobPriorityToSheet } from "@/lib/prod-meta";
import { codeKey, machineMatch, parseQuantity } from "@/lib/work-orders";
import { masterRowForDisplay } from "@/lib/master-lookup";
import { latinDigits } from "@/lib/dates";

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
    const { jobs, writable, configured, duplicates, registryLabels } = await loadJobs();
    return NextResponse.json({ jobs, writable, configured, duplicates, registryLabels });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ jobs: [], writable: false, configured: false, duplicates: [], registryLabels: [] });
  }
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A new work order (2026-09-09 brief). Four things are refused here that the
 * tab already holds today, because nothing refused them before:
 *
 *  - a code that already exists (`Pro/tec 01` is on two rows) — checked on a
 *    FRESH read of the tab, so a colleague's row from a minute ago counts;
 *  - a machine that is not a registry label («ماكينة 100», «220», «280» are
 *    live) — the value written is the registry's own spelling, so the order
 *    can be joined to production rows and «التوقفات» like everything else;
 *  - a quantity that is not a plain number of kilograms («3.1طن»);
 *  - no due date — the state 7 of 10 live orders are in.
 *
 * The product must be a Master name (the sheet's own «حالة الربط» needs the
 * exact spelling, so Master's spelling is what gets written).
 */
export async function POST(req: NextRequest) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const s = (k: string) => String(b[k] ?? "").trim();
    const bad = (reason: string, status = 400) => NextResponse.json({ ok: false, reason }, { status });

    if (!s("code") || !s("product")) return bad("missing_fields");
    // «أوامر العمل»!K is a validated dropdown of exactly four Arabic values —
    // an unknown status must never reach the sheet (jobStatusToSheet refuses
    // rather than guess), so surface the validation error here instead.
    const status = s("status") || "Not Started";
    if (!isJobStatus(status)) return bad("invalid_status");
    if (!ISO_DAY.test(s("dueDate"))) return bad("missing_due");
    const qty = parseQuantity(s("qtyOrdered") || s("qty"));
    if (qty.value === null || !(qty.value > 0)) return bad("bad_qty");
    const materialIssued = s("materialIssued");
    if (materialIssued && parseQuantity(materialIssued).unreadable) return bad("bad_material_issued");
    if (!s("machine")) return bad("missing_machine");

    // The registry (cached is fine — it changes rarely, and it is re-read
    // within 45s), then Master and the tab itself as they are RIGHT NOW.
    const [machines, jobs] = await Promise.all([getRecords("machines"), getRecords("jobs", { fresh: true })]);
    const labels = machines.records
      .map((m) => (m.label || "").trim() || (m.code && m.name ? `${m.code.trim()} — ${latinDigits(m.name.trim())}` : ""))
      .filter(Boolean);
    const mm = machineMatch(latinDigits(s("machine")), labels);
    if (!mm.matched) return bad("bad_machine");

    const key = codeKey(s("code"));
    if (jobs.records.some((r) => codeKey(r.code) === key)) return bad("duplicate_code", 409);

    // The product must exist in Master. The cached copy answers first; a miss
    // is re-checked on a fresh read so a product added to Master a moment ago
    // is not refused for the 45s the copy lives.
    let found = masterRowForDisplay((await getRecords("master")).records, s("product"));
    if (!found.row) found = masterRowForDisplay((await getRecords("master", { fresh: true })).records, s("product"));
    if (!found.row) return bad("unknown_product");

    const res = await appendRecord("jobs", {
      code: s("code"),
      client: s("client"),
      // Master's own spelling — the sheet's «حالة الربط» is MATCH(TRIM(D), Master!C).
      product: found.row.name || s("product"),
      moldCode: s("moldCode"),
      qty: String(qty.value),
      startDate: s("startDate") || new Date().toISOString().slice(0, 10),
      dueDate: s("dueDate"),
      // «أوامر العمل»!K and !L are validated Arabic lists — translate on the way in.
      status: jobStatusToSheet(status),
      priority: jobPriorityToSheet(s("priority") || "Normal"),
      machine: mm.label,
      materialIssued,
      masterbatch: s("masterbatch"),
      instructions: s("instructions"),
      notes: s("notes"),
    });
    // The bridge is at-least-once: a non-ok answer may sit on top of a row
    // that DID land. The page reloads the list before letting anyone retry.
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}
