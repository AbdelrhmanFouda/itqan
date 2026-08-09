import { getDowntimeEvents, type DowntimeEvent } from "@/lib/db";
import { downtimeKey } from "@/lib/downtime";

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
  /** the closed events themselves, for the CSV export and the Pareto. */
  events: DowntimeEvent[];
};

export const EMPTY_DOWNTIME: DowntimeTotals = {
  byKey: new Map(),
  dominantByKey: new Map(),
  byReason: new Map(),
  events: [],
};

/**
 * Load the CLOSED events and total them by day+machine and by reason. A
 * still-running stoppage has no duration yet, so it cannot inform Availability
 * and is excluded until the operator taps stop.
 */
export async function loadDowntimeTotals(): Promise<DowntimeTotals> {
  const events = (await getDowntimeEvents()).filter(
    (e) => e.endedAt != null && e.minutes > 0 && e.date && e.machine,
  );
  const byKey = new Map<string, number>();
  const byReason = new Map<string, number>();
  const perKeyReason = new Map<string, Map<string, number>>();
  for (const e of events) {
    const k = downtimeKey(e.date, e.machine);
    byKey.set(k, (byKey.get(k) ?? 0) + e.minutes);
    const r = e.reason || "Other";
    byReason.set(r, (byReason.get(r) ?? 0) + e.minutes);
    const m = perKeyReason.get(k) ?? new Map<string, number>();
    m.set(r, (m.get(r) ?? 0) + e.minutes);
    perKeyReason.set(k, m);
  }

  const dominantByKey = new Map<string, string>();
  for (const [k, m] of perKeyReason) {
    const top = Array.from(m.entries()).sort((a, b) => b[1] - a[1])[0];
    if (top) dominantByKey.set(k, top[0]);
  }

  return { byKey, dominantByKey, byReason, events };
}
