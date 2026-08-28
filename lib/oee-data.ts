import { getRecords, missingTabs, type SheetRecord } from "@/lib/sheets";
import {
  computeOEE, oeeBy, oeeByMachine, weakestFactor, topLoss, suspectStandards,
  type RunInput, type MoldStandard,
} from "@/lib/oee";
import { normalizeDate, latinDigits } from "@/lib/dates";
import { sumCavities } from "@/lib/cavities";
import { resolveScrap } from "@/lib/scrap";
import { distributeDowntime } from "@/lib/downtime";
import { loadDowntimeTotals, EMPTY_DOWNTIME } from "@/lib/downtime-data";
// The run-join rules are SHARED with /api/runs and lib/jobs.ts — see lib/run-join.ts.
import {
  DEFAULT_SHIFT_MIN, buildShiftLengthIndex, machineKeyOf, resolvePlannedMin,
  plannedMinSource, isStubRun,
} from "@/lib/run-join";

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

// Re-exported so existing importers of this module keep working.
export { DEFAULT_SHIFT_MIN };

const num = (v: unknown) => {
  const x = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(x) ? x : 0;
};

/** Join key for molds/machines: Arabic digits → Latin, lowercase, collapsed spaces. */
const normKey = (s: string | undefined) =>
  latinDigits(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

export type OEEData = Awaited<ReturnType<typeof buildOEEData>>;

export async function buildOEEData(month: string | null) {
  const [prod, master, machinesTab, captured] = await Promise.all([
    getRecords("production"),
    getRecords("master"),
    getRecords("machines"),
    // Downtime from «التوقفات», narrowed to the period being computed. The tab
    // rides the same 45s sheet cache as everything above it. Best-effort: if it
    // is unreachable the OEE picture degrades to "downtime not measured" rather
    // than failing the whole page.
    loadDowntimeTotals(month).catch(() => EMPTY_DOWNTIME),
  ]);

  // Per-mold standards from Master, keyed by normalized code AND name.
  // Cavities go through sumCavities — Master's H holds «4+4» for a two-part
  // mould (8 pieces per shot), and a plain num() read only the first part,
  // understating Performance for such moulds. Same read as lib/jobs.ts.
  const standards = new Map<string, MoldStandard>();
  let standardsInMaster = 0;
  for (const m of master.records) {
    const cycleSec = num(m.cycle), cavities = sumCavities(m.cavities);
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
  // Shared with /api/runs — see buildShiftLengthIndex().
  const lenByKey = buildShiftLengthIndex(machinesTab.records);
  const machinesTabFound = machinesTab.records.length > 0;

  // Classify + normalize the raw rows.
  const isBlank = (v: string | undefined) => !v || !String(v).trim();
  const isStub = isStubRun; // shared with /api/runs — see isStubRun()

  let stubs = 0;
  const plannedSource = { column: 0, machines: 0, default: 0 };
  const moldUnits = new Map<string, { label: string; units: number; hasStd: boolean }>();

  // `sheetDowntimeMin` keeps the run's ORIGINAL «زمن التوقف» value after phone-
  // captured minutes are added to downtimeMin, so the Pareto can still tell the
  // two sources apart.
  let runs: (RunInput & {
    moldLabel: string; sheetDowntimeMin: number;
    scrapSource: "logged" | "system" | "none"; hasMold: boolean; hasSheetDowntime: boolean;
  })[] = [];
  for (const r of prod.records) {
    if (isStub(r)) { stubs++; continue; }

    // Physical machine = the code label when logged (several tonnages have
    // TWO machines — the code is the only unique id), else the tonnage.
    const machine = machineKeyOf(r.machineCode, r.machine);
    const date = normalizeDate(r.date);
    // Join key: mold CODE when logged, else the PRODUCT NAME (what
    // supervisors actually write) — Master standards are keyed by both.
    const moldKey = normKey(r.mold) || normKey(r.product);
    const moldLabel = (r.mold || r.product || "").trim();

    // Scrap comes off the run's OWN row now — «هالك», else سستم − سليم. The
    // cross-tab join it replaced died with «تسجيل الإنتاج»; see lib/scrap.ts.
    const scrap = resolveScrap(r);

    const ownPlanned = num(r.plannedMin);
    const plannedMin = resolvePlannedMin(ownPlanned, machine, r.machine, lenByKey);
    // Which of the three sources answered — reported in `readiness`.
    const src = plannedMinSource(ownPlanned, machine, r.machine, lenByKey);
    if (src === "column") plannedSource.column++;
    else if (src === "registry") plannedSource.machines++;
    else plannedSource.default++;

    if (moldKey) {
      const cur = moldUnits.get(moldKey) ?? { label: moldLabel, units: 0, hasStd: standards.has(moldKey) };
      cur.units += num(r.goodUnits) + scrap.scrapUnits;
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
      scrapUnits: scrap.scrapUnits,
      // Carried so the readiness counters can be taken AFTER the month filter.
      scrapSource: scrap.source,
      hasMold: !isBlank(r.mold) || !isBlank(r.product),
      hasSheetDowntime: !isBlank(r.downtimeMin),
      downtimeMin: num(r.downtimeMin),
      sheetDowntimeMin: num(r.downtimeMin),
      downtimeReason: r.downtimeReason || "None",
    });
  }


  // Downtime from «التوقفات» (phone capture writes the row on stop).
  // «الإنتاج»!J «زمن التوقف» has never been filled in 417 rows, so without this
  // every run carries downtimeMin = 0 and Availability is a flat, meaningless
  // 100%. Spread day+machine totals across that day's runs — see
  // distributeDowntime() for why it must not land on a single run.
  const spread = distributeDowntime(
    runs.map((r) => ({
      date: r.date || "",
      machine: r.machine,
      plannedMin: num(r.plannedMin),
      downtimeMin: num(r.downtimeMin),
    })),
    captured.byKey,
  );
  runs = runs.map((r, i) => {
    const add = spread.perRun[i];
    if (add <= 0) return r;
    // Only count a run once, even if the sheet column ALSO had a value.
    const reasonKnown = r.downtimeReason && r.downtimeReason !== "None";
    return {
      ...r,
      downtimeMin: num(r.downtimeMin) + add,
      // A run with no reason of its own inherits that day's dominant reason, so
      // the Bottleneck Board can name the cause. The Pareto below uses the
      // events directly, so this approximation never distorts the totals.
      downtimeReason: reasonKnown
        ? r.downtimeReason
        : captured.dominantByKey.get(`${r.date}|${normKey(r.machine)}`) ?? "Other",
    };
  });

  // Months present in the data (for the period toggle) — from ALL runs, unfiltered.
  const months = Array.from(new Set(runs.map((r) => (r.date || "").slice(0, 7)).filter(Boolean)))
    .sort()
    .reverse();

  if (month) runs = runs.filter((r) => (r.date || "").startsWith(month));

  /**
   * Readiness counters are taken HERE, after the month filter, because
   * `readiness.runs` is the filtered count and the panel prints them as a pair.
   * They used to be incremented in the row loop above, over the WHOLE tab: with
   * a month selected the panel read "466/398 runs log scrap" — a ratio over 100%
   * that says the opposite of what it means. (Found 2026-08-27; `stubs` stays
   * whole-tab and is reported on its own, not as a ratio.)
   */
  const withMold = runs.filter((r) => r.hasMold).length;
  // AFTER the capture join, so this is "runs with any downtime at all" — the
  // sheet's own column plus the minutes spread on from «التوقفات».
  const withDowntime = runs.filter((r) => num(r.downtimeMin) > 0).length;
  const downtimeFromCapture = runs.filter((r) => num(r.downtimeMin) > 0 && !r.hasSheetDowntime).length;
  const withScrap = runs.filter((r) => r.scrapSource !== "none").length;
  const scrapFromSystem = runs.filter((r) => r.scrapSource === "system").length;
  const scrapUnknown = runs.filter((r) => r.scrapSource === "none").length;

  const overall = computeOEE(runs, standards);

  // Per-machine ranking — worst OEE first; unknown-speed machines sink.
  const byMachine = oeeByMachine(runs, standards);
  const machines = Object.entries(byMachine)
    .map(([machine, o]) => ({ machine, ...o, weakest: weakestFactor(o) }))
    .sort((a, b) => {
      if (a.performanceKnown !== b.performanceKnown) return a.performanceKnown ? -1 : 1;
      return a.oee - b.oee;
    });

  // Captured events for the selected period — used for the reason breakdowns so
  // a day with two different stoppages keeps both, instead of collapsing to the
  // dominant reason the runs carry.
  const capturedInPeriod = captured.events.filter((e) => !month || e.date.startsWith(month));

  // Bottleneck Board — rank by the single biggest fixable loss.
  const machineReason: Record<string, Record<string, number>> = {};
  const addReason = (machine: string, reason: string, minutes: number) => {
    if (minutes <= 0 || !reason || reason === "None") return;
    (machineReason[machine] ??= {});
    machineReason[machine][reason] = (machineReason[machine][reason] || 0) + minutes;
  };
  // Sheet-logged downtime keeps its own reason…
  for (const r of runs) addReason(r.machine, r.downtimeReason || "None", num(r.sheetDowntimeMin));
  // …and phone-captured downtime is attributed event by event.
  for (const e of capturedInPeriod) addReason(e.machine, e.reason, e.minutes);
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

  // Downtime Pareto (excludes "None") — sheet column + phone capture, each at
  // its own recorded reason.
  const reasonMap: Record<string, number> = {};
  const addPareto = (reason: string, minutes: number) => {
    if (minutes > 0 && reason && reason !== "None") {
      reasonMap[reason] = (reasonMap[reason] || 0) + minutes;
    }
  };
  for (const r of runs) addPareto(r.downtimeReason || "None", num(r.sheetDowntimeMin));
  for (const e of capturedInPeriod) addPareto(e.reason, e.minutes);
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
    // Runs whose scrap was computed as سستم − سليم because «هالك» was blank…
    scrapFromSystem,
    // …and runs where NEITHER was available: «لم يُعد بعد» or
    // «الفعلي أكبر من العداد». Their scrap reads 0 and is UNKNOWN, which
    // overstates Quality — the honest count of how much of it is guesswork.
    scrapUnknown,
    withDowntime,
    // PHASE 2 — how much of the downtime picture came from the phone capture
    // rather than the (never-filled) sheet column, and what could not be placed.
    downtimeFromCapture,
    downtimeEventsInPeriod: capturedInPeriod.length,
    downtimeUnallocatedMin: spread.unallocatedMin,
    // Minutes that are a reviewed ESTIMATE rather than a tapped stop.
    downtimeEstimatedMin: captured.estimatedMin,
    downtimeEstimatedCount: captured.estimatedCount,
    /**
     * Stoppages still running after their factory day ended. These carry NO
     * minutes, so they are missing from Availability entirely — the number below
     * is how much of the downtime picture is knowingly absent.
     */
    staleOpen: captured.staleOpen.map((e) => ({
      id: e.id, date: e.date, machine: e.machine, reason: e.reason, startedAt: e.startedAt,
    })),
    plannedSource,
    machinesTabFound,
    // Tabs the workbook no longer has. Surfaced rather than swallowed — an
    // absent tab and an empty one used to be indistinguishable to a reader.
    missingTabs: missingTabs(),
    defaultShiftMin: DEFAULT_SHIFT_MIN,
    standardsInMaster,
    moldsSeen: moldUnits.size,
    moldsSeenWithStd: Array.from(moldUnits.values()).filter((m) => m.hasStd).length,
  };

  // Everything the "how is this calculated" panel needs to show the actual
  // formula with real numbers — and what is measured vs merely assumed.
  const explain = {
    // PHASE 2: Availability is now MEASURED whenever downtime exists for the
    // period — from the phone capture, or from the sheet column if it is ever
    // filled. Before phase 2 this was permanently false and the UI carried a
    // "downtime not logged / assumed" caveat on every OEE number.
    availabilityMeasured: withDowntime > 0,
    /** Where that downtime came from, so the UI can say so honestly. */
    availabilitySource:
      downtimeFromCapture > 0 && withDowntime > downtimeFromCapture
        ? ("both" as const)
        : downtimeFromCapture > 0
        ? ("capture" as const)
        : withDowntime > 0
        ? ("sheet" as const)
        : ("none" as const),
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
