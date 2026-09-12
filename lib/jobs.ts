import { getRecords, type SheetRecord } from "@/lib/sheets";
import { resolveScrap } from "@/lib/scrap";
import { normalizeDate, latinDigits } from "@/lib/dates";
import { jobStatusFromSheet, jobPriorityFromSheet } from "@/lib/prod-meta";
import { distributeDowntime, downtimeKey } from "@/lib/downtime";
import { loadDowntimeTotals, EMPTY_DOWNTIME } from "@/lib/downtime-data";
import {
  buildShiftLengthIndex, machineKeyOf, resolvePlannedMin, isStubRun, num,
} from "@/lib/run-join";
import { sumCavities } from "@/lib/cavities";
import { resolveMoldNumber } from "@/lib/mold-number";
import {
  codeKey, duplicateCodes, isOpenOrder, machineMatch, parseQuantity, registryLabelsFrom,
  type DuplicateCode,
} from "@/lib/work-orders";

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


/**
 * Master's numeric columns are free text: weight reads «15جم», cavities read
 * «4+4» or «2 وش&2 كفر», cycle sometimes reads «تحتسب ورديات». These two
 * helpers match the parsing the sheet formulas do, character for character.
 */
const firstNum = (v: unknown) => {
  const m = String(v ?? "").match(/[0-9]+(?:\.[0-9]+)?/);
  return m ? Number(m[0]) : 0;
};
// Cavities («4+4» → 8) come from lib/cavities.ts, so every caller multiplies
// by the same count this file divides by.
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
  /** The product NAME matches MORE THAN ONE Master row (26 names do, as of the
   *  2026-08-27 survey — it was one). First row wins for the standards below,
   *  which may therefore belong to a different product with the same name; the
   *  UI must say so rather than present them as certain. */
  ambiguous: boolean;
  pieceWeightG: number;
  cavities: number;
  cycleSec: number;
  material: string;
  estHours: number;      // pieces × cycle ÷ (3600 × cavities)
  /** The MOULD NUMBER from Master (D «كود الاسطمبة», else the customer's
   *  number in the notes — lib/mold-number.ts), "" when Master has none.
   *  Distinct from `moldCode`, which is what the customer wrote on the work
   *  order and repeats across customers. */
  masterMoldNumber: string;
  masterMoldNotesNumber: string;
  // --- the order-flow facts (2026-09-09, lib/work-orders.ts) ---
  /** «الكمية المطلوبة (كجم)» is not a plain number («3.1طن» is live in the
   *  tab). qtyOrderedKg is 0 then and qtyRaw carries the cell — nothing is
   *  parsed out of it. */
  qtyUnreadable: boolean;
  qtyRaw: string;
  /** Same for «الخامة المصروفة (كجم)», which is kept as text for display. */
  materialIssuedUnreadable: boolean;
  /** The machine cell matches a registry label («PQ 7 — 100»); `machine`
   *  then carries the registry's own spelling. False for the legacy
   *  «ماكينة 100» / «220» / «280» rows, which are shown as unmatched. */
  machineMatched: boolean;
  /** The job code appears on another row too (`Pro/tec 01`, twice). */
  codeDuplicate: boolean;
  /** Still open — reserves its quantity and sits at the top of the list. */
  open: boolean;
};

export type LoadJobsOptions = {
  /** Join «الإنتاج» for produced / scrapped / remaining. Default true. The
   *  stock screen only needs the ordered quantities and skips it. */
  production?: boolean;
  /** Join «التوقفات» (+ the running stoppage in Firestore) onto the runs.
   *  Default true; needs `production`. The LIST shows no downtime, so
   *  /api/jobs skips it — one bridge tab and a Firestore query fewer. */
  downtime?: boolean;
  /** Read «الماكينات» for the registry labels (`machineMatched`). Default true. */
  machines?: boolean;
};

export async function loadJobs(opts: LoadJobsOptions = {}): Promise<{
  jobs: JobShaped[];
  runsFor: (job: JobShaped) => JobRun[];
  writable: boolean;
  configured: boolean;
  /** Every code held by more than one row. */
  duplicates: DuplicateCode[];
  /** «الماكينات»!J as read — the labels a work order may name. */
  registryLabels: string[];
  /** The OLDEST bridge answer behind these numbers (ms since epoch). */
  readAt: number;
}> {
  const production = opts.production ?? true;
  const downtime = (opts.downtime ?? true) && production;
  const machines = (opts.machines ?? true) || downtime;
  const none = () => ({ records: [] as SheetRecord[], readAt: Date.now() });
  const [jobsTab, prodTab, masterTab, machinesTab, captured] = await Promise.all([
    getRecords("jobs"),
    production ? getRecords("production") : Promise.resolve(none()),
    getRecords("master"),
    // Downtime is not on the production row — «الإنتاج»!J has never been
    // filled. It lives in «التوقفات» and is joined on below, the same way
    // /api/runs and buildOEEData do it, so a job's downtime total matches what
    // the Overview and /performance report for the same runs. Best-effort: if
    // either source is unreachable the page degrades to "no downtime measured"
    // instead of failing.
    machines ? getRecords("machines").catch(none) : Promise.resolve(none()),
    downtime ? loadDowntimeTotals(null).catch(() => EMPTY_DOWNTIME) : Promise.resolve(EMPTY_DOWNTIME),
  ]);
  const readAt = Math.min(jobsTab.readAt, prodTab.readAt, masterTab.readAt, machinesTab.readAt);

  // The registry's labels — «الماكينات»!J («PQ 7 — 100»), the machine's
  // identity everywhere; built from code + tonnage when J is blank, the same
  // way /api/machines builds it. Never hardcoded: the registry has been
  // renumbered four times.
  const registryLabels = registryLabelsFrom(machinesTab.records);

  // Product → standards, first row wins (same as the sheet's VLOOKUP) — and a
  // count per name, because "first row wins" is only honest while the name is
  // unique. Names that appear twice get flagged on the job (`ambiguous`).
  const std = new Map<string, { w: number; cav: number; cyc: number; mat: string; moldNumber: string; moldNotesNumber: string }>();
  const nameCount = new Map<string, number>();
  for (const m of masterTab.records) {
    // NOTE: the master entity calls the product column `name`, not `product`.
    const key = normKey(m.name);
    if (!key) continue;
    nameCount.set(key, (nameCount.get(key) ?? 0) + 1);
    if (std.has(key)) continue;
    const mn = resolveMoldNumber({ code: m.code, notes: m.notes });
    std.set(key, {
      w: firstNum(m.weight),
      cav: sumCavities(m.cavities),
      cyc: firstNum(m.cycle),
      mat: m.material || "",
      moldNumber: mn.number,
      moldNotesNumber: mn.notesNumber,
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
    // Same row-local rule the other two join paths use — «هالك», else سستم −
    // سليم. Before 2026-08-27 this path read «هالك» raw and was the only one of
    // the three that never saw derived scrap, so a job's «هالك» total could sit
    // below the same runs' total on /performance.
    scrapUnits: resolveScrap(r).scrapUnits,
    rowCheck: r.rowCheck || "",
    downtimeMin: num(r.downtimeMin),
    downtimeReason: r.downtimeReason || "None",
    operator: r.operator || "",
    note: r.note || "",
  }));

  // Downtime from «التوقفات», spread across each day+machine's runs — identical
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
    // «الكمية المطلوبة (كجم)» is a plain number of kilograms or it is
    // UNREADABLE — a unit is never parsed out of the cell (3.1 is not 3,100).
    const q = parseQuantity(r.qty);
    const kg = q.value ?? 0;
    const s = std.get(normKey(r.product));
    // The sheet stores these in Arabic; the app speaks English internally.
    const status = r.status ? jobStatusFromSheet(r.status) : "Not Started";
    const mm = machineMatch(latinDigits((r.machine || "").trim()), registryLabels);
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
      ambiguous: (nameCount.get(normKey(r.product)) ?? 0) > 1,
      pieceWeightG: s?.w ?? 0,
      cavities: s?.cav ?? 0,
      cycleSec: s?.cyc ?? 0,
      material: s?.mat ?? "",
      masterMoldNumber: s?.moldNumber ?? "",
      masterMoldNotesNumber: s?.moldNotesNumber ?? "",
      estHours:
        pieces > 0 && s && s.cyc > 0 && s.cav > 0
          ? Math.round((pieces * s.cyc * 10) / (3600 * s.cav)) / 10
          : 0,
      remaining: 0,
      startDate: normalizeDate(r.startDate),
      dueDate: normalizeDate(r.dueDate),
      status,
      priority: r.priority ? jobPriorityFromSheet(r.priority) : "Normal",
      machine: mm.label,
      machineMatched: mm.matched,
      materialIssued: r.materialIssued || "",
      materialIssuedUnreadable: !!(r.materialIssued || "").trim() && parseQuantity(r.materialIssued).unreadable,
      qtyUnreadable: q.unreadable,
      qtyRaw: q.raw,
      codeDuplicate: false, // set below, once every row is known
      open: isOpenOrder(status),
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

  // A code held by more than one row — `Pro/tec 01` on rows 15 and 16 as of
  // 2026-09-09. Flagged on every row that carries it and listed once at the
  // top; POST /api/jobs refuses to add a third.
  const duplicates = duplicateCodes(jobs);
  const dupKeys = new Set(duplicates.map((d) => d.key));
  for (const j of jobs) j.codeDuplicate = dupKeys.has(codeKey(j.code));

  // Open jobs first (soonest due first), finished ones last.
  jobs.sort((a, b) => {
    const ad = a.open ? 0 : 1, bd = b.open ? 0 : 1;
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
    duplicates,
    registryLabels,
    readAt,
  };
}
