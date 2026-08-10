import { getRecords, type SheetRecord } from "@/lib/sheets";
import { normalizeDate, latinDigits } from "@/lib/dates";
import { jobStatusFromSheet, jobPriorityFromSheet } from "@/lib/prod-meta";
import { distributeDowntime, downtimeKey } from "@/lib/downtime";
import { loadDowntimeTotals, EMPTY_DOWNTIME } from "@/lib/downtime-data";
import {
  buildShiftLengthIndex, machineKeyOf, resolvePlannedMin, isStubRun,
} from "@/lib/run-join";

/**
 * Jobs (client work orders) — sheet-backed, `jobs` tab.
 *
 * A job names a PRODUCT (as written in Master / production logs). Progress is
 * computed automatically: production rows whose product/mold matches the job's
 * product, dated on/after the job's start date, count toward the ordered
 * quantity. No run⇄job foreign keys — the product name IS the link, same as
 * the OEE engine.
 *
 * UNITS. The sheet records «الكمية المطلوبة (كجم)» in KILOGRAMS, but the crew
 * logs «إنتاج سليم» in PIECES. Comparing them directly is meaningless (it read
 * "11,150 / 30"), so we convert kg → pieces here using the piece weight from
 * «الرئيسي»:  pieces = kg × 1000 ÷ piece weight (g).
 * `qtyOrdered` is therefore ALWAYS pieces; `qtyOrderedKg` keeps the original.
 * This mirrors the «المطلوب بالقطعة» column added to the jobs tab on
 * 2026-07-27, so the sheet and the site always agree.
 */

const num = (v: unknown) => {
  const x = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(x) ? x : 0;
};

/**
 * Master's numeric columns are free text: weight reads «15جم», cavities read
 * «4+4» or «2 وش&2 كفر», cycle sometimes reads «تحتسب ورديات». These two
 * helpers match the parsing the sheet formulas do, character for character.
 */
const firstNum = (v: unknown) => {
  const m = String(v ?? "").match(/[0-9]+(?:\.[0-9]+)?/);
  return m ? Number(m[0]) : 0;
};
// «4+4» → 8, «2 جراب&2 حزام» → 4, «1 طقم» → 1, «8» → 8
const sumCavities = (v: unknown) => {
  const s = String(v ?? "");
  const a = s.match(/^[^0-9]*([0-9]+(?:\.[0-9]+)?)/);
  const b = s.match(/[+&]\s*([0-9]+(?:\.[0-9]+)?)/);
  return (a ? Number(a[1]) : 0) + (b ? Number(b[1]) : 0);
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
  qtyOrdered: number;    // PIECES — converted from kg via Master's piece weight
  qtyOrderedKg: number;  // as typed by the planner in the sheet
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
  remaining: number;
  // --- pulled from «الرئيسي» by product name; 0 when the product isn't there
  linked: boolean;       // false ⇒ product not registered in Master yet
  pieceWeightG: number;
  cavities: number;
  cycleSec: number;
  material: string;
  estHours: number;      // pieces × cycle ÷ (3600 × cavities)
};

const DONE = new Set(["Completed", "Delivered"]);

export async function loadJobs(): Promise<{
  jobs: JobShaped[];
  runsFor: (job: JobShaped) => JobRun[];
  writable: boolean;
  configured: boolean;
}> {
  const [jobsTab, prodTab, masterTab, machinesTab, captured] = await Promise.all([
    getRecords("jobs"),
    getRecords("production"),
    getRecords("master"),
    // Downtime is not in the sheet — «الإنتاج»!J has never been filled. It is
    // captured on a phone into Firestore and joined on below, the same way
    // /api/runs and buildOEEData do it, so a job's downtime total matches what
    // the Overview and /performance report for the same runs. Best-effort: if
    // either source is unreachable the page degrades to "no downtime measured"
    // instead of failing.
    getRecords("machines").catch(() => ({ records: [] as SheetRecord[] })),
    loadDowntimeTotals(null).catch(() => EMPTY_DOWNTIME),
  ]);

  // Product → standards, first row wins (same as the sheet's VLOOKUP).
  const std = new Map<string, { w: number; cav: number; cyc: number; mat: string }>();
  for (const m of masterTab.records) {
    // NOTE: the master entity calls the product column `name`, not `product`.
    const key = normKey(m.name);
    if (!key || std.has(key)) continue;
    std.set(key, {
      w: firstNum(m.weight),
      cav: sumCavities(m.cavities),
      cyc: firstNum(m.cycle),
      mat: m.material || "",
    });
  }

  // Shape production rows once, keyed by normalized product/mold.
  // NOTE: shaped BEFORE the `.filter(r => r.key)` below so the downtime spread
  // sees every row of the day. A run with no product name still consumed the
  // machine's planned minutes, so dropping it first would hand its share of the
  // stoppage to the other runs and inflate them.
  const shaped = prodTab.records.map((r) => ({
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
  }));

  // Phone-captured downtime, spread across each day+machine's runs — identical
  // key, planned-minutes fallback and stub rule to buildOEEData (see the shared
  // helpers in lib/oee-data.ts) so the totals cannot drift apart.
  const lenByKey = buildShiftLengthIndex(machinesTab.records);
  const live: number[] = [];
  prodTab.records.forEach((rec, i) => { if (!isStubRun(rec)) live.push(i); });
  const spread = distributeDowntime(
    live.map((i) => {
      const rec = prodTab.records[i];
      const mk = machineKeyOf(rec.machineCode, rec.machine);
      return {
        date: shaped[i].date || "",
        machine: mk,
        plannedMin: resolvePlannedMin(num(rec.plannedMin), mk, rec.machine, lenByKey),
        downtimeMin: shaped[i].downtimeMin,
      };
    }),
    captured.byKey,
  );
  live.forEach((i, j) => {
    const add = spread.perRun[j];
    if (add <= 0) return;
    const rec = prodTab.records[i];
    const known = shaped[i].downtimeReason && shaped[i].downtimeReason !== "None";
    shaped[i].downtimeMin += add;
    if (!known) {
      shaped[i].downtimeReason =
        captured.dominantByKey.get(downtimeKey(shaped[i].date, machineKeyOf(rec.machineCode, rec.machine))) ?? "Other";
    }
  });

  const runs = shaped.filter((r) => r.key);

  const matches = (job: JobShaped) => {
    const keys = new Set([normKey(job.moldCode), normKey(job.product)].filter(Boolean));
    if (keys.size === 0) return [];
    return runs.filter((r) => keys.has(r.key) && (!job.startDate || (r.date && r.date >= job.startDate)));
  };

  const jobs: JobShaped[] = jobsTab.records.map((r) => {
    const kg = num(r.qty);
    const s = std.get(normKey(r.product));
    // No piece weight in Master ⇒ we cannot state a piece count. Report 0 and
    // let the UI fall back to showing the kilograms, rather than inventing one.
    const pieces = s && s.w > 0 ? Math.round((kg * 1000) / s.w) : 0;

    const job: JobShaped = {
      id: String(r.row),
      code: r.code || "",
      client: r.client || "",
      product: r.product || "",
      moldCode: latinDigits((r.moldCode || "").trim()),
      qtyOrdered: pieces,
      qtyOrderedKg: kg,
      linked: !!s,
      pieceWeightG: s?.w ?? 0,
      cavities: s?.cav ?? 0,
      cycleSec: s?.cyc ?? 0,
      material: s?.mat ?? "",
      estHours:
        pieces > 0 && s && s.cyc > 0 && s.cav > 0
          ? Math.round((pieces * s.cyc * 10) / (3600 * s.cav)) / 10
          : 0,
      remaining: 0,
      startDate: normalizeDate(r.startDate),
      dueDate: normalizeDate(r.dueDate),
      // The sheet stores these in Arabic; the app speaks English internally.
      status: r.status ? jobStatusFromSheet(r.status) : "Not Started",
      priority: r.priority ? jobPriorityFromSheet(r.priority) : "Normal",
      machine: latinDigits((r.machine || "").trim()),
      materialIssued: r.materialIssued || "",
      masterbatch: r.masterbatch || "",
      instructions: r.instructions || "",
      notes: r.notes || "",
      produced: 0,
      scrapped: 0,
    };
    const rs = matches(job);
    job.produced = rs.reduce((a, x) => a + x.goodUnits, 0);
    job.scrapped = rs.reduce((a, x) => a + x.scrapUnits, 0);
    job.remaining = job.qtyOrdered > 0 ? Math.max(0, job.qtyOrdered - job.produced) : 0;
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
