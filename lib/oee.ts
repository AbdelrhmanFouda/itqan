/**
 * OEE — Overall Equipment Effectiveness. Pure computation, no I/O.
 *
 *   OEE = Availability × Performance × Quality
 *     Availability = Run Time ÷ Planned Time      (Run Time = Planned − Downtime)
 *     Performance  = Ideal Run Time ÷ Run Time     (ideal = units × cycleSec/cavities)
 *     Quality      = Good Units ÷ Total Units       (Total = Good + Scrap)
 *
 * Performance needs each mold's standard cycle time + cavities (from Master). Runs
 * whose mold has no standard are still counted for Availability and Quality, but are
 * excluded from Performance (and tracked via `standardCoverage`) so a missing standard
 * never silently understates the speed number.
 *
 * AGGREGATION RULE (the "89% while every machine is low" bug): a run's ideal
 * minutes are CAPPED at its actual runtime. When Master's cycle time is wrong
 * (too slow), a run appears to produce at 200–500% of standard; uncapped, those
 * impossible ideal minutes flow into the aggregate numerator and cancel out the
 * genuinely slow runs, inflating overall Performance far above every per-machine
 * figure. Capping keeps the aggregate a true weighted average of per-run
 * performance (each ≤ 100%). The capped-away minutes are reported as
 * `overspeedMin`, and `suspectStandards()` names the molds whose Master cycle
 * needs review.
 *
 * Verified against the plan's Appendix A worked example: 87.5 / 89.3 / 96.0 / ≈75%.
 */

export type RunInput = {
  machine: string;
  mold: string;
  date?: string;
  shift?: string;
  plannedMin: number | string;
  goodUnits: number | string;
  scrapUnits: number | string;
  downtimeMin: number | string;
  downtimeReason?: string;
};

export type MoldStandard = { cycleSec: number; cavities: number };

export type OEEResult = {
  availability: number;   // 0..1
  performance: number;    // 0..1 (0 when unknown — see performanceKnown)
  quality: number;        // 0..1
  oee: number;            // 0..1 (0 when performance unknown)
  performanceKnown: boolean;
  standardCoverage: number; // share of units made by molds that have a standard
  // raw aggregates (minutes / units)
  plannedMin: number;
  runtimeMin: number;
  downtimeMin: number;
  goodUnits: number;
  scrapUnits: number;
  totalUnits: number;
  /** Runtime on runs whose mold HAS a standard — Performance's denominator. */
  stdRuntimeMin: number;
  /** Capped ideal minutes for all units on standard-bearing runs — Performance's numerator. */
  idealMin: number;
  // capacity lost (minutes), split by cause. perf/quality are 0 when no standard.
  // These three sum to: plannedMin − (ideal minutes for the good units made).
  lossDowntimeMin: number;
  lossPerformanceMin: number;
  lossQualityMin: number;
  /** Ideal minutes discarded because a run "beat" its standard (cap at runtime).
   *  > 0 means some Master cycle times are wrong — see suspectStandards(). */
  overspeedMin: number;
};

const n = (v: number | string | undefined): number => {
  const x = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(x) ? x : 0;
};
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Compute OEE over a set of runs, joined to per-mold standards (keyed by mold). */
export function computeOEE(runs: RunInput[], standards: Map<string, MoldStandard>): OEEResult {
  let plannedMin = 0, downtimeMin = 0, goodUnits = 0, scrapUnits = 0;
  let idealRtMin = 0, idealGoodMin = 0, stdRuntimeMin = 0, stdUnits = 0, overspeedMin = 0;

  for (const r of runs) {
    // Clamp against bad data: no negatives, and downtime can't exceed planned
    // time (you can't lose more than you planned). Keeps the loss identity intact.
    const pm = Math.max(0, n(r.plannedMin));
    const dm = Math.min(pm, Math.max(0, n(r.downtimeMin)));
    const g = Math.max(0, n(r.goodUnits));
    const s = Math.max(0, n(r.scrapUnits));
    const total = g + s;
    const runtime = Math.max(0, pm - dm);
    plannedMin += pm; downtimeMin += dm; goodUnits += g; scrapUnits += s;

    const std = standards.get(r.mold);
    if (std && std.cycleSec > 0 && std.cavities > 0) {
      const perUnit = (std.cycleSec / std.cavities) / 60; // ideal minutes per part
      const ideal = total * perUnit;
      // Cap this run's ideal time at its actual runtime: a run can't be more
      // than 100% efficient. Uncapped, a wrong (too-slow) Master cycle lets one
      // mold inject impossible minutes that mask every genuinely slow run.
      const scale = ideal > runtime && ideal > 0 ? runtime / ideal : 1;
      idealRtMin += ideal * scale;
      idealGoodMin += g * perUnit * scale;
      overspeedMin += ideal - ideal * scale;
      stdRuntimeMin += runtime;
      stdUnits += total;
    }
  }

  const runtimeMin = Math.max(0, plannedMin - downtimeMin);
  const totalUnits = goodUnits + scrapUnits;
  const availability = plannedMin > 0 ? runtimeMin / plannedMin : 0;
  const quality = totalUnits > 0 ? goodUnits / totalUnits : 0;
  const performanceKnown = stdRuntimeMin > 0;
  const performance = performanceKnown ? clamp01(idealRtMin / stdRuntimeMin) : 0;
  const oee = performanceKnown ? availability * performance * quality : 0;

  return {
    availability, performance, quality, oee, performanceKnown,
    standardCoverage: totalUnits ? stdUnits / totalUnits : 0,
    plannedMin, runtimeMin, downtimeMin, goodUnits, scrapUnits, totalUnits,
    stdRuntimeMin, idealMin: idealRtMin,
    lossDowntimeMin: downtimeMin,
    lossPerformanceMin: performanceKnown ? Math.max(0, stdRuntimeMin - idealRtMin) : 0,
    lossQualityMin: performanceKnown ? Math.max(0, idealRtMin - idealGoodMin) : 0,
    overspeedMin,
  };
}

/** A mold whose logged output implies a much faster cycle than Master says. */
export type SuspectStandard = {
  mold: string;            // join key as passed in RunInput.mold
  units: number;           // total units logged for this mold
  runtimeMin: number;      // runtime accumulated on runs of this mold
  ratio: number;           // ideal ÷ runtime (2.0 = "ran at 200% of standard")
  masterCycleSec: number;  // what Master currently says
  cavities: number;
  impliedCycleSec: number; // cycle the logged output actually implies
};

/**
 * Find molds running impossibly faster than their Master standard — the
 * fingerprint of a wrong cycle time (or of over-reported Good units).
 * `threshold` is the ratio above which a standard is flagged (default 110%).
 */
export function suspectStandards(
  runs: RunInput[],
  standards: Map<string, MoldStandard>,
  threshold = 1.1,
): SuspectStandard[] {
  const agg = new Map<string, { units: number; runtime: number; ideal: number; std: MoldStandard }>();
  for (const r of runs) {
    const std = standards.get(r.mold);
    if (!std || std.cycleSec <= 0 || std.cavities <= 0) continue;
    const pm = Math.max(0, n(r.plannedMin));
    const dm = Math.min(pm, Math.max(0, n(r.downtimeMin)));
    const runtime = Math.max(0, pm - dm);
    const total = Math.max(0, n(r.goodUnits)) + Math.max(0, n(r.scrapUnits));
    if (total <= 0) continue;
    const cur = agg.get(r.mold) ?? { units: 0, runtime: 0, ideal: 0, std };
    cur.units += total;
    cur.runtime += runtime;
    cur.ideal += total * ((std.cycleSec / std.cavities) / 60);
    agg.set(r.mold, cur);
  }
  const out: SuspectStandard[] = [];
  for (const [mold, a] of agg) {
    if (a.runtime <= 0 || a.units <= 0) continue;
    const ratio = a.ideal / a.runtime;
    if (ratio > threshold) {
      out.push({
        mold,
        units: a.units,
        runtimeMin: Math.round(a.runtime),
        ratio,
        masterCycleSec: a.std.cycleSec,
        cavities: a.std.cavities,
        impliedCycleSec: (a.runtime * 60 * a.std.cavities) / a.units,
      });
    }
  }
  return out.sort((x, y) => y.ratio - x.ratio);
}

/** The single biggest fixable loss for a machine/mold — drives the Bottleneck Board. */
export type LossFactor = "downtime" | "performance" | "quality";
export function topLoss(o: OEEResult): { factor: LossFactor; minutes: number } {
  const losses: [LossFactor, number][] = [
    ["downtime", o.lossDowntimeMin],
    ["performance", o.lossPerformanceMin],
    ["quality", o.lossQualityMin],
  ];
  losses.sort((a, b) => b[1] - a[1]);
  return { factor: losses[0][0], minutes: losses[0][1] };
}

/** Group runs by a key (e.g. machine or mold) and compute OEE for each bucket. */
export function oeeBy(
  runs: RunInput[],
  key: (r: RunInput) => string,
  standards: Map<string, MoldStandard>,
): Record<string, OEEResult> {
  const buckets: Record<string, RunInput[]> = {};
  for (const r of runs) {
    const k = key(r) || "—";
    (buckets[k] ??= []).push(r);
  }
  const out: Record<string, OEEResult> = {};
  for (const [k, rs] of Object.entries(buckets)) out[k] = computeOEE(rs, standards);
  return out;
}

export const oeeByMachine = (runs: RunInput[], standards: Map<string, MoldStandard>) =>
  oeeBy(runs, (r) => r.machine, standards);
export const oeeByMold = (runs: RunInput[], standards: Map<string, MoldStandard>) =>
  oeeBy(runs, (r) => r.mold, standards);

/** Name the weakest OEE factor — the thing to attack first. Used by the bottleneck view. */
export function weakestFactor(o: OEEResult): "availability" | "performance" | "quality" | null {
  if (!o.performanceKnown) return null;
  const factors: [("availability" | "performance" | "quality"), number][] = [
    ["availability", o.availability],
    ["performance", o.performance],
    ["quality", o.quality],
  ];
  factors.sort((a, b) => a[1] - b[1]);
  return factors[0][0];
}
