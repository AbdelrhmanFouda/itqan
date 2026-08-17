/**
 * Downtime maths. Pure computation, no I/O (same rule as lib/oee.ts, so it
 * stays unit-testable without Firebase or the bridge). The fetching half is
 * lib/downtime-data.ts.
 *
 * ── Where downtime lives, as of 2026-08-14 ────────────────────────────────
 * In the SHEET, tab «التوقفات», like «الإنتاج» and «الأعطال». This reverses the
 * phase-2 arrangement, under which downtime was the one piece of factory data
 * kept in Firestore because the workbook was frozen; the owner has since had
 * the tab created (../production/scripts/downtime-tab.gs) and ruled the sheet
 * the source of truth. Firestore keeps exactly ONE thing now: the stoppage that
 * is running at this second. It has no minutes yet, and «التوقفات»!D is
 * validated greater than zero, so an open stoppage cannot be a legal row — the
 * row is written when somebody taps stop, always with measured minutes. There
 * is deliberately no "write it as 0 and fix it later" path.
 *
 * «الإنتاج»!J «زمن التوقف» is still not the place: it has never been filled once
 * in 418 rows. Downtime is joined onto production runs from «التوقفات» here,
 * exactly the way `deriveScrap()` joins «تسجيل الإنتاج» scrap onto those runs.
 *
 * The join key is `date | machine`, where machine is the «الماكينات»!J label
 * ("PQ 7 — 100"). Tonnage alone would merge PQ 5 with PQ 7 (both 100 t).
 */

// Kept local (rather than importing lib/dates) so this module has ZERO imports
// and Node's test runner can load it directly — the same trade lib/oee.ts makes.
// Behaviour matches latinDigits(): both Arabic-Indic ranges fold to 0-9.
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹";
const normKey = (s: string | undefined): string =>
  (s ?? "")
    .replace(/[٠-٩۰-۹]/g, (d) => String(AR_DIGITS.indexOf(d) % 10))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export const downtimeKey = (date: string, machine: string) => `${date}|${normKey(machine)}`;

/** Shape of a stored event, mirrored from lib/db.ts so this module stays pure. */
export type DowntimeEventLike = {
  date: string;
  machine: string;
  reason: string;
  minutes: number;
  startedAt: number;
  endedAt: number | null;
  createdBy: string;
};

/* ------------------------ unclosed stoppages ------------------------------ */

/**
 * A stoppage whose factory day has ENDED while it is still running.
 *
 * This is the likeliest real failure of the capture: the operator taps start,
 * the shift ends, nobody taps stop. The event then has no duration, so it is
 * excluded from Availability — which under-counts downtime while every number
 * on the page still looks healthy. That silence is the danger, so these are
 * surfaced to the OWNER (dashboard home + the monthly report), not left on the
 * entry page where only the floor would see them.
 *
 * Nothing closes them automatically. A human reviews and closes each one, which
 * marks it `estimated` — an unreviewed guess must never reach Availability.
 */
export function isStaleOpen(
  e: { endedAt: number | null; date: string },
  today: string,
): boolean {
  return e.endedAt == null && !!e.date && e.date < today;
}

/**
 * ⚠ REMOVED 2026-08-17 — the rule it encoded was wrong.
 *
 * `estimatedStopMinutes(startedAt, factoryDayEndMs)` capped a reconstructed
 * stoppage at 08:00 the following morning, on the reasoning that a machine
 * "cannot have been down past the shift it was logged in".
 *
 * The owner's correction: **a shift ending does not restart the machine.** The
 * captured data agrees emphatically — 21 of the 37 stoppages already run past
 * 08:00, and they carry 14,973 of the 17,253 minutes. Capping there was
 * deleting most of the downtime this feature exists to measure.
 *
 * There is no replacement helper: a reconstructed close now runs to the moment
 * somebody closes it, which is `stopDowntimeEvent`'s own default, so no
 * arithmetic is needed. Kept as a note because the deleted function had tests
 * asserting the cap, and a future reader finding them in git history should
 * know they were removed deliberately rather than lost.
 *
 * What bounds a forgotten tap is `isStaleOpen()` putting it in front of the
 * owner the next morning, plus the `estimated` flag — not a cap that quietly
 * threw minutes away.
 */

/* ------------------------------ the tally --------------------------------- */

/** The fields of a stoppage that any total depends on, whatever the store. */
export type DowntimeCountable = {
  date: string;
  machine: string;
  reason: string;
  minutes: number;
  estimated?: boolean;
};

/**
 * A stoppage that can inform a number.
 *
 * All three conditions matter and none is cosmetic. No minutes → nothing to
 * add, and «التوقفات»!D validates > 0 precisely so a zero never becomes one.
 * No date or no machine → the row cannot be joined to a production run, so
 * counting it in the headline while it is absent from every per-machine figure
 * would make two views of the same month disagree.
 */
export const countsTowardDowntime = (e: DowntimeCountable): boolean =>
  !!e.date && !!e.machine && e.minutes > 0;

export type DowntimeTally = {
  /** `date|machine` → stopped minutes. */
  byKey: Map<string, number>;
  /** `date|machine` → the reason with the most minutes that day. */
  dominantByKey: Map<string, string>;
  /** canonical reason → minutes, for the Pareto at full fidelity. */
  byReason: Map<string, number>;
  /** of the above, how many minutes are a RECONSTRUCTION rather than a measurement. */
  estimatedMin: number;
  estimatedCount: number;
  /** the rows that were actually counted (the rest failed countsTowardDowntime). */
  counted: DowntimeCountable[];
};

/**
 * Total a list of stoppages by day+machine and by reason.
 *
 * Kept here, pure, rather than inline in the loader, because it is the same
 * arithmetic whether the rows came from «التوقفات» or (before 2026-08-14) from
 * Firestore — and because the migration between the two had to prove the
 * totals were identical, which needs a function a test can call.
 *
 * A row with no reason is tallied as "Other" for GROUPING only. That is not a
 * claim about the stoppage: `downtimeReasonFromSheet` returns "" for a blank
 * cell and passes an unknown word through as itself, so the only thing that
 * lands in this bucket is a genuinely empty «سبب التوقف».
 */
export function summarizeDowntime(events: readonly DowntimeCountable[]): DowntimeTally {
  const byKey = new Map<string, number>();
  const byReason = new Map<string, number>();
  const perKeyReason = new Map<string, Map<string, number>>();
  const counted: DowntimeCountable[] = [];
  let estimatedMin = 0;
  let estimatedCount = 0;

  for (const e of events) {
    if (!countsTowardDowntime(e)) continue;
    counted.push(e);
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

  return { byKey, dominantByKey, byReason, estimatedMin, estimatedCount, counted };
}

export type DowntimeRun = {
  date: string;
  machine: string;
  plannedMin: number;
  /** downtime already on the run (from the sheet column, if it is ever filled). */
  downtimeMin: number;
};

export type DowntimeSpread = {
  /** extra downtime minutes for each run, index-aligned with the input (0 = none). */
  perRun: number[];
  /** minutes that could not be placed because the day's runs had no room left. */
  unallocatedMin: number;
  /** how many runs received downtime. */
  runsTouched: number;
};

/**
 * Spread each day+machine's captured downtime across that day's production runs.
 *
 * Why spread rather than dump it on one run: `computeOEE()` clamps each run's
 * downtime to that run's planned minutes (`Math.min(pm, downtimeMin)`), so
 * assigning a whole day's stoppage to a single 720-minute run would silently
 * discard everything past 720 and understate the loss. Each run therefore only
 * receives up to its remaining headroom (planned − downtime already logged),
 * shared in proportion to that headroom, remainder-exact so the integer split
 * still sums to the captured total.
 *
 * Anything that genuinely does not fit — more downtime than the day had planned
 * minutes, or a stoppage on a machine nobody logged production for, which means
 * the capture or the shift length needs a look — is returned as
 * `unallocatedMin` rather than silently dropped.
 */
export function distributeDowntime(runs: DowntimeRun[], byKey: Map<string, number>): DowntimeSpread {
  const perRun = new Array<number>(runs.length).fill(0);
  let unallocatedMin = 0;
  let runsTouched = 0;

  const groups = new Map<string, number[]>();
  runs.forEach((r, i) => {
    if (!r.date) return; // undated rows can't be joined to a day
    const k = downtimeKey(r.date, r.machine);
    if (!byKey.has(k)) return;
    const g = groups.get(k);
    if (g) g.push(i);
    else groups.set(k, [i]);
  });

  // Captured days with no production row to attach to — surfaced, not lost.
  for (const [k, minutes] of byKey) if (!groups.has(k)) unallocatedMin += minutes;

  for (const [k, idxs] of groups) {
    const total = byKey.get(k) ?? 0;
    if (total <= 0) continue;
    const room = idxs.map((i) => Math.max(0, runs[i].plannedMin - runs[i].downtimeMin));
    const capacity = room.reduce((a, b) => a + b, 0);
    if (capacity <= 0) { unallocatedMin += total; continue; }

    const placeable = Math.min(total, capacity);
    unallocatedMin += total - placeable;

    let assigned = 0;
    idxs.forEach((i, j) => {
      // The last run mops up the rounding remainder; every share is then capped
      // at that run's own headroom so none can exceed its planned minutes.
      const share = Math.min(
        Math.max(0, j === idxs.length - 1 ? placeable - assigned : Math.round((room[j] / capacity) * placeable)),
        room[j],
      );
      assigned += share;
      if (share > 0) { perRun[i] = share; runsTouched++; }
    });
    // Rounding can leave a little unplaced when the last run hits its cap.
    unallocatedMin += Math.max(0, placeable - assigned);
  }

  return { perRun, unallocatedMin, runsTouched };
}

/* ------------------------------- CSV export ------------------------------- */

const csvCell = (v: unknown): string => {
  const s = String(v ?? "");
  // Quote when the value could break the row, and double any embedded quote.
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const DOWNTIME_CSV_HEADERS = [
  "date", "machine", "reason", "reason_ar", "minutes",
  "startedAt", "endedAt", "createdBy",
] as const;

/**
 * Downtime as CSV, so the owner can move this into the workbook himself later
 * if he ever wants it there — the point of keeping it exportable from day one.
 * A UTF-8 BOM is prepended because Excel otherwise renders Arabic as mojibake.
 */
export function downtimeCsv(
  events: DowntimeEventLike[],
  reasonAr: (key: string) => string,
): string {
  const iso = (ms: number | null) => (ms ? new Date(ms).toISOString() : "");
  const lines = [DOWNTIME_CSV_HEADERS.join(",")];
  for (const e of events) {
    lines.push([
      e.date, e.machine, e.reason, reasonAr(e.reason), e.minutes,
      iso(e.startedAt), iso(e.endedAt), e.createdBy,
    ].map(csvCell).join(","));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}
