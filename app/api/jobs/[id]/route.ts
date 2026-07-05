import { NextRequest, NextResponse } from "next/server";
import { getRecords, updateRecord, deleteRecord } from "@/lib/sheets";
import { loadJobs } from "@/lib/jobs";
import { latinDigits } from "@/lib/dates";

// One job (sheet row) + the production runs credited to it + the product's
// Master standard (weight/material/cycle/defects → expected rates) so the
// page can render a full أمر شغل (work order).

const num = (v: unknown) => {
  const x = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(x) ? x : 0;
};
const normKey = (s: string | undefined) =>
  latinDigits(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const changes: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) {
      const key = k === "qtyOrdered" ? "qty" : k;
      if (EDITABLE.has(key)) changes[key] = String(v ?? "");
    }
    const res = await updateRecord("jobs", Number(id), changes);
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const res = await deleteRecord("jobs", Number(id));
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}
