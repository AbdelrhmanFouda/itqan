import { getRecords } from "@/lib/sheets";
import {
  computeOEE, oeeBy, oeeByMachine, weakestFactor, topLoss, suspectStandards,
  type RunInput, type MoldStandard,
} from "@/lib/oee";
import { normalizeDate, latinDigits } from "@/lib/dates";

/**
 * The OEE dataset — one function, one truth. Reads the sheet's Production tab,
 * joins Master (per-mold cycle/cavities) and the machines REGISTRY (shift
 * length by code), and returns everything the Performance page and the AI
 * review need. Used by /api/oee and /api/ai-review so they can never disagree.
 *
 * Correctness rules:
 *  - Planned time per run: the run's own planned column (if present) → the
 *    machine's registry shift length → DEFAULT_SHIFT_MIN.
 *  - Dates normalized to ISO before filtering/grouping.
 *  - Mold join keys normalized (digits/case/space); code first, else product name.
 *  - Stub rows (nothing logged) are excluded and counted in `readiness`.
 *  - Per-run ideal time is capped at runtime (see lib/oee.ts) — wrong Master
 *    cycles can no longer inflate the aggregate; they surface in `suspects`.
 */

export const DEFAULT_SHIFT_MIN = 720; // 12h shift — config used by the capture form too

const num = (v: unknown) => {
  const x = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(x) ? x : 0;
};

/** Join key for molds/machines: Arabic digits → Latin, lowercase, collapsed spaces. */
const normKey = (s: string | undefined) =>
  latinDigits(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

export type OEEData = Awaited<ReturnType<typeof buildOEEData>>;

export async function buildOEEData(month: string | null) {
  const [prod, master, machinesTab] = await Promise.all([
    getRecords("production"),
    getRecords("master"),
    getRecords("machines"),
  ]);

  // Per-mold standards from Master, keyed by normalized code AND name.
  const standards = new Map<string, MoldStandard>();
  let standardsInMaster = 0;
  for (const m of master.records) {
    const cycleSec = num(m.cycle), cavities = num(m.cavities);
    if (cycleSec > 0 && cavities > 0) {
      standardsInMaster++;
      const std: MoldStandard = { cycleSec, cavities };
      const code = normKey(m.code), name = normKey(m.name);
      if (code) standards.set(code, std);
      if (name) standards.set(name, std);
    }
  }

  // Planned time: the machines tab is a REGISTRY (one row per physical machine,
  // keyed by code — no dates). Planned minutes = that machine's shift length,
  // looked up by its code label ("PQPI 4 — 220"), bare code, or tonnage.
  const lenByKey = new Map<string, number>();
  for (const m of machinesTab.records) {
    const len = num(m.shiftLength);
    if (len <= 0) continue;
    const code = (m.code || "").trim();
    const name = latinDigits((m.name || "").trim());
    const label = code ? `${code} — ${name}` : name ? `${name} — بدون كود` : "";
    for (const k of [label, code, name]) {
      const nk = normKey(k);
      if (nk && !lenByKey.has(nk)) lenByKey.set(nk, len);
    }
  }
  const machinesTabFound = machinesTab.records.length > 0;

  // Classify + normalize the raw rows.
  type Raw = (typeof prod.records)[number];
  const isBlank = (v: string | undefined) => !v || !String(v).trim();
  const isStub = (r: Raw) => isBlank(r.goodUnits) && isBlank(r.scrapUnits) && isBlank(r.downtimeMin);

  let stubs = 0, withMold = 0, withScrap = 0, withDowntime = 0;
  const plannedSource = { column: 0, machines: 0, default: 0 };
  const moldUnits = new Map<string, { label: string; units: number; hasStd: boolean }>();

  let runs: (RunInput & { moldLabel: string })[] = [];
  for (const r of prod.records) {
    if (isStub(r)) { stubs++; continue; }
    if (!isBlank(r.mold) || !isBlank(r.product)) withMold++;
    if (!isBlank(r.scrapUnits)) withScrap++;
    if (!isBlank(r.downtimeMin)) withDowntime++;

    // Physical machine = the code label when logged (several tonnages have
    // TWO machines — the code is the only unique id), else the tonnage.
    const machine = (r.machineCode || "").trim() || latinDigits((r.machine || "—").trim());
    const date = normalizeDate(r.date);
    // Join key: mold CODE when logged, else the PRODUCT NAME (what
    // supervisors actually write) — Master standards are keyed by both.
    const moldKey = normKey(r.mold) || normKey(r.product);
    const moldLabel = (r.mold || r.product || "").trim();

    const ownPlanned = num(r.plannedMin);
    let plannedMin: number;
    if (ownPlanned > 0) { plannedMin = ownPlanned; plannedSource.column++; }
    else {
      const fromPlan = lenByKey.get(normKey(machine)) ?? lenByKey.get(normKey(r.machine));
      if (fromPlan) { plannedMin = fromPlan; plannedSource.machines++; }
      else { plannedMin = DEFAULT_SHIFT_MIN; plannedSource.default++; }
    }

    if (moldKey) {
      const cur = moldUnits.get(moldKey) ?? { label: moldLabel, units: 0, hasStd: standards.has(moldKey) };
      cur.units += num(r.goodUnits) + num(r.scrapUnits);
      moldUnits.set(moldKey, cur);
    }

    runs.push({
      machine,
      mold: moldKey,
      moldLabel,
      date,
      openCavities: num(r.openCavities),
      shift: r.shift || "",
      plannedMin,
      goodUnits: num(r.goodUnits),
      scrapUnits: num(r.scrapUnits),
      downtimeMin: num(r.downtimeMin),
      downtimeReason: r.downtimeReason || "None",
    });
  }

  // Months present in the data (for the period toggle) — from ALL runs, unfiltered.
  const months = Array.from(new Set(runs.map((r) => (r.date || "").slice(0, 7)).filter(Boolean)))
    .sort()
    .reverse();

  if (month) runs = runs.filter((r) => (r.date || "").startsWith(month));

  const overall = computeOEE(runs, standards);

  // Per-machine ranking — worst OEE first; unknown-speed machines sink.
  const byMachine = oeeByMachine(runs, standards);
  const machines = Object.entries(byMachine)
    .map(([machine, o]) => ({ machine, ...o, weakest: weakestFactor(o) }))
    .sort((a, b) => {
      if (a.performanceKnown !== b.performanceKnown) return a.performanceKnown ? -1 : 1;
      return a.oee - b.oee;
    });

  // Bottleneck Board — rank by the single biggest fixable loss.
  const machineReason: Record<string, Record<string, number>> = {};
  for (const r of runs) {
    const reason = r.downtimeReason || "None";
    const dm = num(r.downtimeMin);
    if (dm > 0 && reason !== "None") {
      (machineReason[r.machine] ??= {});
      machineReason[r.machine][reason] = (machineReason[r.machine][reason] || 0) + dm;
    }
  }
  const topReasonFor = (m: string): string | null => {
    const rm = machineReason[m];
    if (!rm) return null;
    return Object.entries(rm).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  const bottlenecks = machines
    .map((m) => {
      const tl = topLoss(m);
      const lostMin = m.lossDowntimeMin + m.lossPerformanceMin + m.lossQualityMin;
      const idealGoodMin = m.performanceKnown ? m.oee * m.plannedMin : 0; // OEE = idealGood ÷ planned
      return {
        machine: m.machine,
        factor: tl.factor,
        factorMin: Math.round(tl.minutes),
        lostMin: Math.round(lostMin),
        oee: m.oee,
        performanceKnown: m.performanceKnown,
        recoverablePct: idealGoodMin > 0 ? tl.minutes / idealGoodMin : null,
        topDowntimeReason: topReasonFor(m.machine),
      };
    })
    .filter((b) => b.factorMin > 0)
    .sort((a, b) => b.factorMin - a.factorMin);

  // Downtime Pareto (excludes "None").
  const reasonMap: Record<string, number> = {};
  for (const r of runs) {
    const reason = r.downtimeReason || "None";
    const m = num(r.downtimeMin);
    if (m > 0 && reason !== "None") reasonMap[reason] = (reasonMap[reason] || 0) + m;
  }
  const downtime = Object.entries(reasonMap)
    .map(([reason, minutes]) => ({ reason, minutes }))
    .sort((a, b) => b.minutes - a.minutes);

  // Daily trend — OEE factors + scrap per ISO day. Undated runs are excluded
  // from the trend (still in the totals above).
  const dated = runs.filter((r) => r.date);
  const byDay = oeeBy(dated, (r) => r.date as string, standards);
  const trend = Object.entries(byDay)
    .map(([date, o]) => ({
      date,
      availability: o.availability,
      performance: o.performanceKnown ? o.performance : null,
      quality: o.quality,
      oee: o.performanceKnown ? o.oee : null,
      good: o.goodUnits,
      scrap: o.scrapUnits,
      scrapRate: o.totalUnits > 0 ? o.scrapUnits / o.totalUnits : 0,
      downtimeMin: o.downtimeMin,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  // Which logged molds still need standards in Master — biggest volume first.
  const standardsGap = Array.from(moldUnits.values())
    .filter((m) => !m.hasStd)
    .sort((a, b) => b.units - a.units)
    .slice(0, 8)
    .map((m) => ({ mold: m.label, units: m.units }));

  // Molds whose output implies a much faster cycle than Master says — the
  // wrong standards that used to inflate the headline. Labeled for the UI.
  const suspects = suspectStandards(runs, standards).map((s) => ({
    ...s,
    mold: moldUnits.get(s.mold)?.label || s.mold,
    impliedCycleSec: Math.round(s.impliedCycleSec * 10) / 10,
    ratio: Math.round(s.ratio * 100) / 100,
  }));

  const readiness = {
    runs: runs.length,
    stubs,
    withMold,
    withScrap,
    withDowntime,
    plannedSource,
    machinesTabFound,
    defaultShiftMin: DEFAULT_SHIFT_MIN,
    standardsInMaster,
    moldsSeen: moldUnits.size,
    moldsSeenWithStd: Array.from(moldUnits.values()).filter((m) => m.hasStd).length,
  };

  // Everything the "how is this calculated" panel needs to show the actual
  // formula with real numbers — and what is measured vs merely assumed.
  const explain = {
    availabilityMeasured: withDowntime > 0,
    qualityMeasured: withScrap > 0,
    plannedMin: Math.round(overall.plannedMin),
    downtimeMin: Math.round(overall.downtimeMin),
    runtimeMin: Math.round(overall.runtimeMin),
    stdRuntimeMin: Math.round(overall.stdRuntimeMin),
    idealMin: Math.round(overall.idealMin),
    overspeedMin: Math.round(overall.overspeedMin),
    goodUnits: overall.goodUnits,
    scrapUnits: overall.scrapUnits,
  };

  return {
    overall: { ...overall, weakest: weakestFactor(overall) },
    bottlenecks, machines, downtime, trend, months,
    readiness, standardsGap, suspects, explain,
    runCount: runs.length, configured: true as const,
  };
}
