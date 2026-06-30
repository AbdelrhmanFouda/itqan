import { NextRequest, NextResponse } from "next/server";
import { getRecords } from "@/lib/sheets";
import { computeOEE, oeeByMachine, weakestFactor, topLoss, type RunInput, type MoldStandard } from "@/lib/oee";

// Computes OEE and the supporting loss views from the sheet's Production tab,
// joined to per-mold standards (cycle/cavities) read from Master.

const num = (v: unknown) => {
  const x = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(x) ? x : 0;
};

export async function GET(req: NextRequest) {
  try {
    const month = req.nextUrl.searchParams.get("month"); // "YYYY-MM" or null = all
    const [prod, master] = await Promise.all([getRecords("production"), getRecords("master")]);

    // Per-mold standards, keyed by BOTH code and name (runs may store either).
    const standards = new Map<string, MoldStandard>();
    for (const m of master.records) {
      const cycleSec = num(m.cycle), cavities = num(m.cavities);
      if (cycleSec > 0 && cavities > 0) {
        const std: MoldStandard = { cycleSec, cavities };
        if (m.code) standards.set(m.code, std);
        if (m.name) standards.set(m.name, std);
      }
    }

    let runs: RunInput[] = prod.records.map((r) => ({
      machine: r.machine || "—",
      mold: r.mold || "",
      date: r.date || "",
      shift: r.shift || "",
      plannedMin: r.plannedMin,
      goodUnits: r.goodUnits,
      scrapUnits: r.scrapUnits,
      downtimeMin: r.downtimeMin,
      downtimeReason: r.downtimeReason || "None",
    }));
    if (month) runs = runs.filter((r) => (r.date || "").startsWith(month));

    const overall = computeOEE(runs, standards);

    const byMachine = oeeByMachine(runs, standards);
    const machines = Object.entries(byMachine)
      .map(([machine, o]) => ({ machine, ...o, weakest: weakestFactor(o) }))
      .sort((a, b) => {
        // worst OEE first; machines whose speed is unknown sink to the bottom
        if (a.performanceKnown !== b.performanceKnown) return a.performanceKnown ? -1 : 1;
        return a.oee - b.oee;
      });

    // Bottleneck Board — rank machines by the single biggest fixable loss, and
    // name it. Top downtime reason per machine fuels the suggested action.
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

    // Scrap-rate daily trend.
    const dayMap: Record<string, { good: number; scrap: number }> = {};
    for (const r of runs) {
      const d = r.date || "";
      if (!d) continue;
      const g = num(r.goodUnits), s = num(r.scrapUnits);
      (dayMap[d] ??= { good: 0, scrap: 0 });
      dayMap[d].good += g; dayMap[d].scrap += s;
    }
    const daily = Object.entries(dayMap)
      .map(([date, v]) => ({
        date, good: v.good, scrap: v.scrap,
        scrapRate: v.good + v.scrap ? v.scrap / (v.good + v.scrap) : 0,
      }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    // Months present in the data (for the period toggle) — unfiltered.
    const months = Array.from(
      new Set(prod.records.map((r) => (r.date || "").slice(0, 7)).filter(Boolean)),
    ).sort().reverse();

    return NextResponse.json({
      overall: { ...overall, weakest: weakestFactor(overall) },
      bottlenecks, machines, downtime, daily, months,
      runCount: runs.length, configured: true,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { overall: null, bottlenecks: [], machines: [], downtime: [], daily: [], months: [], runCount: 0, configured: false },
      { status: 200 },
    );
  }
}
