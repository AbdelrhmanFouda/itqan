import { NextRequest, NextResponse } from "next/server";
import { getRecords, updateRecord, deleteRecord } from "@/lib/sheets";
import { loadJobs } from "@/lib/jobs";
import { latinDigits } from "@/lib/dates";
import { requireRole } from "@/lib/api-guard";
import { isJobStatus, jobStatusToSheet, jobPriorityToSheet } from "@/lib/prod-meta";

// One job (sheet row) + the production runs credited to it + the product's
// Master standard (weight/material/cycle/defects → expected rates) so the
// page can render a full أمر شغل (work order).

const num = (v: unknown) => {
  const x = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(x) ? x : 0;
};
const normKey = (s: string | undefined) =>
  latinDigits(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

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

    // Master standard for this product (matched by mold code or name).
    const keys = new Set([normKey(job.moldCode), normKey(job.product)].filter(Boolean));
    const m = master.records.find(
      (r) => keys.has(normKey(r.code)) || keys.has(normKey(r.name)),
    );
    let standard = null;
    if (m) {
      const cycleSec = num(m.cycle), cavities = num(m.cavities);
      const perHour = cycleSec > 0 && cavities > 0 ? (3600 / cycleSec) * cavities : null;
      standard = {
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
  const norm = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  let target = master.records.find((r) => r.row === row && norm(r.name) === norm(name));
  if (!target) {
    const hits = master.records.filter((r) => norm(r.name) === norm(name));
    if (hits.length !== 1) return { ok: false, reason: "identity_mismatch" };
    target = hits[0];
  }
  return updateRecord("master", target.row, changes);
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
