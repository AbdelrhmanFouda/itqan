import { NextRequest, NextResponse } from "next/server";
import { getRecords, updateRecord, deleteRecord } from "@/lib/sheets";
import { loadJobs } from "@/lib/jobs";
import { requireRole } from "@/lib/api-guard";
import { isJobStatus, jobStatusToSheet, jobPriorityToSheet } from "@/lib/prod-meta";
import { resolveMoldNumber } from "@/lib/mold-number";
import { masterRowByName, masterRowForDisplay } from "@/lib/master-lookup";

// One job (sheet row) + the production runs credited to it + the product's
// Master standard (weight/material/cycle/defects → expected rates) so the
// page can render a full أمر شغل (work order).

const num = (v: unknown) => {
  const x = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(x) ? x : 0;
};

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
        // The Master row + raw cell text, so the page can offer an EDIT of the
        // product's standard. Master's numeric columns are free text on purpose
        // («4+4», «15جم», «تحتسب ورديات») — the edit must round-trip the raw
        // string, never a parsed number, or it would destroy that notation.
        row: m.row,
        name: m.name || "",
        cavitiesRaw: m.cavities || "",
        cycleRaw: m.cycle || "",
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

const EDITABLE = new Set([
  "code", "client", "product", "moldCode", "qty", "startDate", "dueDate",
  "status", "priority", "machine", "materialIssued", "masterbatch", "instructions", "notes",
]);

// The Master columns the job page may edit — the product's STANDARD, nothing
// that carries identity. `name`, `code` and `id` are deliberately absent:
// everything in the workbook joins on the product name, so renaming from here
// would orphan every production row and job at once.
const MASTER_EDITABLE = new Set(["weight", "material", "cavities", "cycle", "defects"]);

/**
 * Edit the product's standard in «الرئيسي», located by NAME, not by row.
 *
 * The row number the client holds came from an earlier read, and a colleague
 * edits this sheet daily — rows shift. So the name is verified against a FRESH
 * read at the stored row first, and if it moved, re-resolved by name; zero or
 * several matches refuse rather than guess («سماعة اريون» genuinely exists
 * twice in Master, rows 289 and 453). Same identity rule as `mapToMaster()`,
 * including the whitespace-folding normalization — «زراير» carries a trailing
 * tab that one-sided trimming would break.
 */
async function updateMasterStandard(m: { row?: unknown; name?: unknown; changes?: unknown }) {
  const row = Number(m.row);
  const name = String(m.name ?? "");
  const changes: Record<string, string> = {};
  for (const [k, v] of Object.entries((m.changes ?? {}) as Record<string, unknown>)) {
    if (MASTER_EDITABLE.has(k)) changes[k] = String(v ?? "");
  }
  if (!name.trim()) return { ok: false, reason: "no_name" };
  if (Object.keys(changes).length === 0) return { ok: true };

  const master = await getRecords("master", { fresh: true });
  // The same name-only rule the register's PATCH uses (lib/master-lookup.ts):
  // the held row wins while it still carries the name, else exactly one row
  // by name, else refuse.
  const target = masterRowByName(master.records, name, row);
  if (!target.ok) return { ok: false, reason: target.reason === "no_name" ? "no_name" : "identity_mismatch" };
  return updateRecord("master", target.row.row, changes);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  const { id } = await params;
  try {
    const body = (await req.json()) as Record<string, unknown>;

    // A Master-standard edit rides this route (rather than the generic sheet
    // PATCH) so it gets the name-verified row resolution above.
    if (body.master && typeof body.master === "object") {
      const res = await updateMasterStandard(body.master as Record<string, unknown>);
      return NextResponse.json(res, { status: res.ok ? 200 : 400 });
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
      if (key === "status" && !isJobStatus(val)) {
        return NextResponse.json({ ok: false, reason: "invalid_status" }, { status: 400 });
      }
      changes[key] =
        key === "status" ? jobStatusToSheet(val) : key === "priority" ? jobPriorityToSheet(val) : val;
    }
    const res = await updateRecord("jobs", Number(id), changes);
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
