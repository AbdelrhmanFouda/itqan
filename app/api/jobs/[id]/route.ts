import { NextRequest, NextResponse } from "next/server";
import { getRecords, updateRecord, deleteRecord, expectSupported } from "@/lib/sheets";
import { loadJobs } from "@/lib/jobs";
import { requireRole } from "@/lib/api-guard";
import { isJobStatus, jobStatusToSheet, jobPriorityToSheet } from "@/lib/prod-meta";
import { resolveMoldNumber } from "@/lib/mold-number";
import { masterRowForDisplay, masterRowForPick } from "@/lib/master-lookup";
import { codeKey, parseQuantity, registryLabelForTonnage, registryLabelsFrom, ISO_DAY } from "@/lib/work-orders";
import { num } from "@/lib/run-join";

// One job (sheet row) + the production runs credited to it + the product's
// Master standard (weight/material/cycle/defects → expected rates) so the
// page can render a full أمر شغل (work order).


// Guarded like the jobs list (2026-08-28): the detail carries the client, the
// ordered quantity and the Master standard — not an open operational read.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  const { id } = await params;
  try {
    const [{ jobs, runsFor }, master] = await Promise.all([loadJobs(), getRecords("master")]);
    const job = jobs.find((j) => j.id === id);
    if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });

    // Master standard for this product — matched by product NAME ONLY.
    // Until 2026-09-04 this also matched the job's mould code against Master's
    // code column, first row wins, and for five of the ten live work orders
    // that returned ANOTHER customer's product: «زراير» (code 6) was shown
    // «عدسه شفاف»'s standard, code 6 of المصرية الذكية, and the edit button
    // would have written to that row. Customers number their own tool sets
    // from 1, so codes repeat across Master; the name is the only identity.
    const found = masterRowForDisplay(master.records, job.product);
    const m = found.row;
    let standard = null;
    if (m) {
      const cycleSec = num(m.cycle), cavities = num(m.cavities);
      const perHour = cycleSec > 0 && cavities > 0 ? (3600 / cycleSec) * cavities : null;
      const mn = resolveMoldNumber({ code: m.code, notes: m.notes });
      standard = {
        // The MOULD NUMBER as Master holds it (D «كود الاسطمبة», else the
        // customer's number from the notes) — distinct from the work order's
        // own «كود الاسطمبة», which is whatever the customer wrote on it.
        moldNumber: mn.number,
        moldNumberSource: mn.source,
        moldNotesNumber: mn.notesNumber,
        notes: m.notes || "",
        // The name matches more than one Master row: the standard shown is the
        // first row's and may belong to a different product with that name.
        ambiguous: found.ambiguous,
        weight: m.weight || "",
        material: m.material || "",
        cavities: cavities || null,
        cycleSec: cycleSec || null,
        defects: m.defects || "",
        ratePerHour: perHour ? Math.round(perHour) : null,
        ratePerShift12h: perHour ? Math.round(perHour * 12) : null,
      };
    }

    return NextResponse.json({ job, runs: runsFor(job), standard });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "sheet error" }, { status: 500 });
  }
}

// What the jobs pages send (2026-09-13): the product — picked from Master,
// its client and mould number follow it (see PATCH) — the kilograms, the two
// dates, status, priority and the order's own notes. The code, client, mould
// code and machine are no longer typed on the site.
const EDITABLE = new Set([
  "product", "qty", "startDate", "dueDate",
  "status", "priority", "materialIssued", "masterbatch", "instructions", "notes",
]);


export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  const { id } = await params;
  try {
    const body = (await req.json()) as Record<string, unknown>;

    const bad = (reason: string, status = 400) => NextResponse.json({ ok: false, reason }, { status });

    // Optional identity check (the list page's one-tap status change sends
    // it): the row number the phone holds came from an earlier read and a
    // colleague edits this tab too. On a FRESH read the row must still carry
    // the same job code, or nothing is written — 409, same shape as
    // PATCH /api/issues/[row].
    const expect = body.expect;
    let expectOpt: { field: string; value: string } | undefined;
    if (expect && typeof expect === "object") {
      // Bridge version 7 checks the row INSIDE the write (one round trip);
      // an older bridge gets the fresh read here, as before (two).
      const canExpect = await expectSupported();
      const copy = await getRecords("jobs", { fresh: !canExpect });
      const rec = copy.records.find((r) => r.row === Number(id));
      const want = codeKey(String((expect as { code?: unknown }).code ?? ""));
      if (!rec || !want || codeKey(rec.code) !== want) return bad("row_changed", 409);
      if (canExpect) expectOpt = { field: "code", value: rec.code };
    }

    const changes: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) {
      const key = k === "qtyOrdered" ? "qty" : k;
      if (!EDITABLE.has(key)) continue;
      const val = String(v ?? "");
      // «أوامر العمل»!K and !L are validated Arabic lists — translate on the way in.
      // !K accepts EXACTLY four values; an unknown one would be rejected by the
      // sheet mid-batch and trip the rollback machinery, so refuse it here with
      // a clean validation error before it can reach a write.
      if (key === "status" && !isJobStatus(val)) return bad("invalid_status");
      // The rules a new order obeys (app/api/jobs/route.ts): a quantity is a
      // plain number of kilograms, material issued too, and a date is a date.
      if (key === "qty" && val.trim()) {
        const q = parseQuantity(val);
        if (q.value === null || !(q.value > 0)) return bad("bad_qty");
        changes[key] = String(q.value);
        continue;
      }
      if (key === "materialIssued" && val.trim() && parseQuantity(val).unreadable) return bad("bad_material_issued");
      if (key === "dueDate" && val.trim() && !ISO_DAY.test(val.trim())) return bad("missing_due");
      if (key === "startDate" && val.trim() && !ISO_DAY.test(val.trim())) return bad("bad_start");
      if (key === "product") {
        // Picked from «الرئيسي» (2026-09-13): the order takes the picked row's
        // spelling and, as one unit, its client, mould number and — when its
        // tonnage names one press — machine (blank otherwise, so the page
        // shows where the order last ran). A product Master does not know is
        // never written.
        const tapped = Number(body.masterRow) > 0 ? Number(body.masterRow) : undefined;
        let row = masterRowForPick((await getRecords("master")).records, val, tapped);
        if (!row) row = masterRowForPick((await getRecords("master", { fresh: true })).records, val, tapped);
        if (!row) return bad("unknown_product");
        changes.product = row.name || val.trim();
        changes.client = (row.client || "").trim();
        changes.moldCode = resolveMoldNumber({ code: row.code, notes: row.notes }).number;
        changes.machine = registryLabelForTonnage(row.machine, registryLabelsFrom((await getRecords("machines")).records));
        continue;
      }
      changes[key] =
        key === "status" ? jobStatusToSheet(val) : key === "priority" ? jobPriorityToSheet(val) : val;
    }
    const res = await updateRecord("jobs", Number(id), changes, expectOpt ? { expect: expectOpt } : {});
    if (!res.ok && res.reason === "row_changed") return bad("row_changed", 409);
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  const { id } = await params;
  try {
    const res = await deleteRecord("jobs", Number(id));
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}
