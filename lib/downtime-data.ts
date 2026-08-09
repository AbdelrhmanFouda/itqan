import { getDowntimeEventsBetween, getOpenDowntimeEvents, type DowntimeEvent } from "@/lib/db";
import { downtimeKey, isStaleOpen } from "@/lib/downtime";
import { factoryDay } from "@/lib/dates";

/**
 * Fetch + shape half of the downtime feature (lib/downtime.ts holds the pure
 * maths). Mirrors the lib/oee.ts ↔ lib/oee-data.ts split.
 */

export type DowntimeTotals = {
  /** `date|machine` → stopped minutes captured on the phone. */
  byKey: Map<string, number>;
  /** `date|machine` → the reason with the most minutes that day. */
  dominantByKey: Map<string, string>;
  /** canonical reason → minutes, for the Pareto at full fidelity. */
  byReason: Map<string, number>;
  /** the closed events in range, for the Pareto and the report. */
  events: DowntimeEvent[];
  /** of those, how many minutes came from an ESTIMATED close rather than a tap. */
  estimatedMin: number;
  estimatedCount: number;
  /**
   * Stoppages still running after their factory day ended — the silent
   * under-count. NOT bounded by the period: an unclosed event from March still
   * needs the owner's attention in August.
   */
  staleOpen: DowntimeEvent[];
};

export const EMPTY_DOWNTIME: DowntimeTotals = {
  byKey: new Map(),
  dominantByKey: new Map(),
  byReason: new Map(),
  events: [],
  estimatedMin: 0,
  estimatedCount: 0,
  staleOpen: [],
};

/** Inclusive date bounds covering a whole month, or a wide window when unscoped. */
export function monthRange(month: string | null): { from: string; to: string } {
  if (month && /^\d{4}-\d{2}$/.test(month)) return { from: `${month}-01`, to: `${month}-31` };
  return { from: "0000-01-01", to: "9999-12-31" };
}

/**
 * Load the events for a period and total them by day+machine and by reason.
 *
 * Only CLOSED events inform Availability — a stoppage still running has no
 * duration yet. The open ones are not thrown away though: those whose factory
 * day has ended come back as `staleOpen` so the owner can see what the crew
 * forgot to stop.
 */
export async function loadDowntimeTotals(month: string | null = null): Promise<DowntimeTotals> {
  const { from, to } = monthRange(month);
  // The date range is bounded so this does not scan the whole collection on
  // every OEE computation. The open-event query is a separate single-field
  // equality and is naturally tiny (one row per machine at worst).
  const [inRange, open] = await Promise.all([
    getDowntimeEventsBetween(from, to),
    getOpenDowntimeEvents(),
  ]);

  const events = inRange.filter((e) => e.endedAt != null && e.minutes > 0 && e.date && e.machine);
  const byKey = new Map<string, number>();
  const byReason = new Map<string, number>();
  const perKeyReason = new Map<string, Map<string, number>>();
  let estimatedMin = 0;
  let estimatedCount = 0;

  for (const e of events) {
    const k = downtimeKey(e.date, e.machine);
    byKey.set(k, (byKey.get(k) ?? 0) + e.minutes);
    const r = e.reason || "Other";
    byReason.set(r, (byReason.get(r) ?? 0) + e.minutes);
    const m = perKeyReason.get(k) ?? new Map<string, number>();
    m.set(r, (m.get(r) ?? 0) + e.minutes);
    perKeyReason.set(k, m);
    if (e.estimated) { estimatedMin += e.minutes; estimatedCount++; }
  }

  const dominantByKey = new Map<string, string>();
  for (const [k, m] of perKeyReason) {
    const top = Array.from(m.entries()).sort((a, b) => b[1] - a[1])[0];
    if (top) dominantByKey.set(k, top[0]);
  }

  const today = factoryDay();
  const staleOpen = open
    .filter((e) => isStaleOpen(e, today))
    .sort((a, b) => a.startedAt - b.startedAt); // oldest neglect first

  return { byKey, dominantByKey, byReason, events, estimatedMin, estimatedCount, staleOpen };
}
