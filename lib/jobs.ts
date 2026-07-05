import { getRecords } from "@/lib/sheets";
import { normalizeDate, latinDigits } from "@/lib/dates";

/**
 * Jobs (client work orders) — sheet-backed, `jobs` tab.
 *
 * A job names a PRODUCT (as written in Master / production logs). Progress is
 * computed automatically: production rows whose product/mold matches the job's
 * product, dated on/after the job's start date, count toward the ordered
 * quantity. No run⇄job foreign keys — the product name IS the link, same as
 * the OEE engine.
 */

const num = (v: unknown) => {
  const x = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(x) ? x : 0;
};
const normKey = (s: string | undefined) =>
  latinDigits(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

export type JobRun = {
  id: string;
  date: string;       // ISO
  machine: string;
  goodUnits: number;
  scrapUnits: number;
  downtimeMin: number;
  downtimeReason: string;
  operator: string;
  note: string;
};

export type JobShaped = {
  id: string;         // sheet row number
  code: string;
  client: string;
  product: string;
  moldCode: string;
  qtyOrdered: number;
  startDate: string;  // ISO or ""
  dueDate: string;    // ISO or ""
  status: string;
  priority: string;
  machine: string;
  materialIssued: string;
  masterbatch: string;
  instructions: string;
  notes: string;
  produced: number;
  scrapped: number;
};

const DONE = new Set(["Completed", "Delivered"]);

export async function loadJobs(): Promise<{
  jobs: JobShaped[];
  runsFor: (job: JobShaped) => JobRun[];
  writable: boolean;
  configured: boolean;
}> {
  const [jobsTab, prodTab] = await Promise.all([
    getRecords("jobs"),
    getRecords("production"),
  ]);

  // Shape production rows once, keyed by normalized product/mold.
  const runs = prodTab.records
    .map((r) => ({
      id: String(r.row),
      key: normKey(r.mold) || normKey(r.product),
      date: normalizeDate(r.date),
      machine: latinDigits((r.machine || "").trim()),
      goodUnits: num(r.goodUnits),
      scrapUnits: num(r.scrapUnits),
      downtimeMin: num(r.downtimeMin),
      downtimeReason: r.downtimeReason || "None",
      operator: r.operator || "",
      note: r.note || "",
    }))
    .filter((r) => r.key);

  const matches = (job: JobShaped) => {
    const keys = new Set([normKey(job.moldCode), normKey(job.product)].filter(Boolean));
    if (keys.size === 0) return [];
    return runs.filter((r) => keys.has(r.key) && (!job.startDate || (r.date && r.date >= job.startDate)));
  };

  const jobs: JobShaped[] = jobsTab.records.map((r) => {
    const job: JobShaped = {
      id: String(r.row),
      code: r.code || "",
      client: r.client || "",
      product: r.product || "",
      moldCode: latinDigits((r.moldCode || "").trim()),
      qtyOrdered: num(r.qty),
      startDate: normalizeDate(r.startDate),
      dueDate: normalizeDate(r.dueDate),
      status: r.status || "In Production",
      priority: r.priority || "Normal",
      machine: latinDigits((r.machine || "").trim()),
      materialIssued: r.materialIssued || "",
      masterbatch: r.masterbatch || "",
      instructions: r.instructions || "",
      notes: r.notes || "",
      produced: 0,
      scrapped: 0,
    };
    const rs = matches(job);
    job.produced = rs.reduce((s, x) => s + x.goodUnits, 0);
    job.scrapped = rs.reduce((s, x) => s + x.scrapUnits, 0);
    return job;
  });

  // Active jobs first (soonest due first), finished ones last.
  jobs.sort((a, b) => {
    const ad = DONE.has(a.status) ? 1 : 0, bd = DONE.has(b.status) ? 1 : 0;
    if (ad !== bd) return ad - bd;
    const adate = a.dueDate || "9999", bdate = b.dueDate || "9999";
    if (adate !== bdate) return adate < bdate ? -1 : 1;
    return Number(b.id) - Number(a.id);
  });

  return {
    jobs,
    runsFor: (job) => matches(job).sort((a, b) => (a.date > b.date ? -1 : 1)),
    writable: jobsTab.writable,
    configured: jobsTab.fields.length > 0,
  };
}
