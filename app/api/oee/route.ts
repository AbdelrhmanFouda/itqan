import { NextRequest, NextResponse } from "next/server";
import { getRecords } from "@/lib/sheets";
import { computeOEE, oeeBy, oeeByMachine, weakestFactor, topLoss, type RunInput, type MoldStandard } from "@/lib/oee";
import { normalizeDate, latinDigits } from "@/lib/dates";

/**
 * OEE from the sheet's Production tab, joined to Master (per-mold cycle/cavities)
 * and Machines (per-machine shift length).
 *
 * Correctness rules:
 *  - Planned time per run resolves through a chain: the run's own planned column
 *    (if the sheet has one) → the machine's shift length from the Machines tab
 *    → DEFAULT_SHIFT_MIN. The sheet currently has no planned column, so without
 *    this chain Availability was always 0.
 *  - Dates are normalized to ISO before any filtering/grouping (the sheet sends
 *    "6/30/2026", which used to break the month filter and the months list).
 *  - Mold codes are join-normalized (digits/case/space) — hand-typed codes still match.
 *  - Rows with nothing logged (no good, no scrap, no downtime) are stubs: excluded
 *    from the math, reported in `readiness`.
 *  - Nothing is faked: `readiness` tells the UI which inputs are actually logged.
 */

const DEFAULT_SHIFT_MIN = 720; // 12h shift — config used by the capture form too

const num = (v: unknown) => {
  const x = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(x) ? x : 0;
};

/** Join key for molds/machines: Arabic digits → Latin, lowercase, collapsed spaces. */
const normKey = (s: string | undefined) =>
  latinDigits(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

export async function GET(req: NextRequest) {
  try {
    const month = req.nextUrl.searchParams.get("month"); // "YYYY-MM" or null = all
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

    // Planned time from the machines DAILY PLAN tab: prefer the exact
    // (machine, ISO date) row, else the machine's most recent logged shift
    // length, else the 720-min default.
    const dayPlan = new Map<string, number>(); // "machine|date" → minutes
    const latestLen = new Map<string, { date: string; len: number }>();
    for (const m of machinesTab.records) {
      const k = normKey(m.name), len = num(m.shiftLength);
      if (!k || len <= 0) continue;
      const d = normalizeDate(m.date);
      if (d) dayPlan.set(`${k}|${d}`, len);
      const cur = latestLen.get(k);
      if (!cur || d > cur.date) latestLen.set(k, { date: d, len });
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

      const machine = latinDigits((r.machine || "—").trim());
      const date = normalizeDate(r.date);
      // Join key: mold CODE when logged, else the PRODUCT NAME (what
      // supervisors actually write) — Master standards are keyed by both.
      const moldKey = normKey(r.mold) || normKey(r.product);
      const moldLabel = (r.mold || r.product || "").trim();

      const ownPlanned = num(r.plannedMin);
      let plannedMin: number;
      if (ownPlanned > 0) { plannedMin = ownPlanned; plannedSource.column++; }
      else {
        const mk = normKey(machine);
        const fromPlan = dayPlan.get(`${mk}|${date}`) ?? latestLen.get(mk)?.len;
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

    return NextResponse.json({
      overall: { ...overall, weakest: weakestFactor(overall) },
      bottlenecks, machines, downtime, trend, months,
      readiness, standardsGap,
      runCount: runs.length, configured: true,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      {
        overall: null, bottlenecks: [], machines: [], downtime: [], trend: [],
        months: [], readiness: null, standardsGap: [], runCount: 0, configured: false,
      },
      { status: 200 },
    );
  }
}
