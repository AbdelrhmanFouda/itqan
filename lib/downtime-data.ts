import { getRecords, appendRecord, type SheetRecord, type UpdateResult } from "@/lib/sheets";
import {
  getOpenDowntimeEvents, getPendingDowntimeEvents, markDowntimeSynced, type DowntimeEvent,
} from "@/lib/db";
import {
  summarizeDowntime, countsTowardDowntime, isStaleOpen, splitAcrossFactoryDays,
} from "@/lib/downtime";
import {
  normalizeDate, latinDigits, factoryDay, parseClockMinutes, factoryDaySpan, formatClock,
} from "@/lib/dates";
import {
  downtimeReasonFromSheet, downtimeEstimatedFromSheet, downtimeReasonAr,
  DOWNTIME_YES, DOWNTIME_NO,
} from "@/lib/prod-meta";

/**
 * Fetch + shape half of the downtime feature (lib/downtime.ts holds the pure
 * maths). Mirrors the lib/oee.ts ↔ lib/oee-data.ts split.
 *
 * ── The source changed on 2026-08-14 ──────────────────────────────────────
 * This used to read Firestore `downtimeEvents`. It now reads the sheet tab
 * «التوقفات», which the owner made the source of truth. The return shape is
 * deliberately UNCHANGED: `lib/oee-data.ts`, `app/api/runs` and `lib/jobs.ts`
 * all consume `DowntimeTotals` and all three must keep producing the same
 * number for the same month — that agreement is what lib/run-join.ts exists to
 * protect, and swapping the store underneath it must not disturb it.
 *
 * Firestore keeps ONE responsibility: the stoppage running right now. It has no
 * minutes until somebody taps stop, and «التوقفات»!D is validated greater than
 * zero, so an open stoppage has no legal row. `staleOpen` therefore still comes
 * from Firestore — and its read is separately caught, because a Firebase outage
 * must not be able to erase the sheet's minutes from every page.
 *
 * Cost: one more tab in the 45-second sheet cache (lib/sheets.ts). «التوقفات»
 * is a few dozen rows and every caller here was already reading three or four
 * tabs, so this adds a cached read, not a page load.
 */

/** A stoppage as «التوقفات» records it. Structurally a superset of
 *  `DowntimeEvent`, so consumers that were typed against the Firestore shape
 *  keep working unchanged. */
export type DowntimeRecord = {
  id: string;
  /** the 1-based «التوقفات» row, so a wrong figure can be pointed at its cell. */
  row: number;
  date: string;         // ISO factory day
  machine: string;      // «الماكينات»!J label — the join key to «الإنتاج»
  reason: string;       // canonical key (see downtimeReasonFromSheet)
  minutes: number;
  startedAt: number;    // 0 when «بداية التوقف» was left blank
  /** «بداية التوقف» as minutes-of-day (Cairo wall clock), null when blank —
   *  what `splitAcrossFactoryDays` needs to place a multi-day stoppage. */
  startClockMin: number | null;
  endedAt: number | null;
  createdBy: string;    // «سُجل بواسطة»
  estimated: boolean;   // «تقديري؟» = نعم
  closedBy: string;
  notes: string;
};

export type DowntimeTotals = {
  /** `date|machine` → stopped minutes. */
  byKey: Map<string, number>;
  /** `date|machine` → the reason with the most minutes that day. */
  dominantByKey: Map<string, string>;
  /** canonical reason → minutes, for the Pareto at full fidelity. */
  byReason: Map<string, number>;
  /** the stoppages in range that count, for the Pareto and the report. */
  events: DowntimeRecord[];
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

/** Arabic-Indic digits fold first; «غير متاح» has already become "" in getRecords. */
const num = (v: string | undefined): number => {
  const n = Number(latinDigits(String(v ?? "")).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/**
 * One «التوقفات» row → a stoppage.
 *
 * Everything ambiguous goes through a shared parser rather than being read off
 * the cell: the date through `normalizeDate` (this workbook mixes zero-padded
 * day-first text with Sheets-rendered month-first dates in one column), the
 * reason through `downtimeReasonFromSheet` (the sheet speaks Arabic and the
 * rest of the app speaks canonical keys), the clock times through
 * `parseClockMinutes`. `clean()` in lib/sheets has already turned «غير متاح /
 * N/A» into "" — which for the minutes column means "not recorded", and the row
 * is dropped by `countsTowardDowntime` rather than counted as a zero.
 */
export function shapeDowntimeRow(r: SheetRecord): DowntimeRecord {
  const date = normalizeDate(r.date);
  const startClockMin = parseClockMinutes(r.start);
  // Both clock times resolved as a PAIR — see factoryDaySpan() for why an end
  // of «8:00» after a 19:28 start belongs to the next morning.
  const { startedAt, endedAt } = factoryDaySpan(
    date, startClockMin, parseClockMinutes(r.end),
  );
  return {
    id: `row:${r.row}`,
    row: r.row,
    date,
    machine: (r.machine || "").trim(),
    reason: downtimeReasonFromSheet(r.reason),
    minutes: num(r.minutes),
    startedAt,
    startClockMin,
    endedAt: endedAt || null,
    createdBy: r.loggedBy || "",
    estimated: downtimeEstimatedFromSheet(r.estimated),
    closedBy: "",
    notes: r.notes || "",
  };
}

/** Every stoppage in «التوقفات», newest first. Unfiltered — callers narrow. */
export async function loadDowntimeRecords(
  opts: { fresh?: boolean } = {},
): Promise<DowntimeRecord[]> {
  const { records } = await getRecords("downtime", opts);
  const rows = records.map(shapeDowntimeRow);

  // A row whose date will not parse can never be joined to a production run, so
  // it drops out of every total — silently, which is the failure mode this
  // codebase keeps paying for. It cannot be repaired from here (guessing a date
  // is worse than losing one), but it can be made visible: the message names the
  // sheet row so somebody can go and look at the cell.
  const undated = rows.filter((r) => !r.date && (r.machine || r.minutes > 0));
  if (undated.length > 0) {
    console.warn(
      `[downtime] «التوقفات» has ${undated.length} row(s) with an unreadable date — ` +
        `excluded from every total: ${undated.map((r) => `row ${r.row}`).join(", ")}`,
    );
  }

  return rows.sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : (b.startedAt || 0) - (a.startedAt || 0),
  );
}

/**
 * Load the stoppages for a period and total them by day+machine and by reason.
 *
 * Only rows that carry minutes inform Availability — `countsTowardDowntime`
 * decides, and it is the same predicate the migration used to prove the totals
 * were unchanged. Unclosed stoppages are not thrown away: those whose factory
 * day has ended come back as `staleOpen` so the owner can see what the crew
 * forgot to stop.
 */
export async function loadDowntimeTotals(month: string | null = null): Promise<DowntimeTotals> {
  const { from, to } = monthRange(month);
  const [all, open] = await Promise.all([
    loadDowntimeRecords(),
    // Caught here, not by the caller: a Firestore outage should cost the
    // stale-stoppage banner and nothing else. Letting it reject would take the
    // whole call down to EMPTY_DOWNTIME and silently zero the sheet's minutes
    // on every page — the exact failure shape this feature keeps producing.
    getOpenDowntimeEvents().catch(() => [] as DowntimeEvent[]),
  ]);

  /**
   * The TALLY works on day-slices, not rows (2026-08-27, owner's word): a
   * multi-day stoppage contributes to every factory day it covered, not just
   * its start day. Sliced over ALL rows BEFORE the month filter, deliberately —
   * a stoppage that started 31 July and ran into 2 August must contribute its
   * August minutes to August, and its July minutes must not leak in. A row
   * without a start clock stays whole on its start day (the old behaviour).
   */
  const slices = all.flatMap((e) => {
    if (!countsTowardDowntime(e)) return [e];
    const parts = splitAcrossFactoryDays(e.date, e.startClockMin, e.minutes);
    if (parts.length <= 1) return [e];
    return parts.map((p) => ({ ...e, date: p.date, minutes: p.minutes }));
  });
  const tally = summarizeDowntime(slices.filter((s) => s.date >= from && s.date <= to));
  // `events` stays one entry per ROW (Pareto listing, report, CSV counts) —
  // membership by start day, same predicate as the tally so they cannot
  // disagree about which rows are real.
  const events = all
    .filter((e) => e.date >= from && e.date <= to)
    .filter(countsTowardDowntime);

  const today = factoryDay();
  const staleOpen = open
    .filter((e) => isStaleOpen(e, today))
    .sort((a, b) => a.startedAt - b.startedAt); // oldest neglect first

  return {
    byKey: tally.byKey,
    dominantByKey: tally.dominantByKey,
    byReason: tally.byReason,
    events,
    estimatedMin: tally.estimatedMin,
    estimatedCount: tally.estimatedCount,
    staleOpen,
  };
}

/* -------------------------------- writing --------------------------------- */

/** What a finished stoppage needs to become a «التوقفات» row. */
export type DowntimeRowInput = {
  date: string;            // ISO factory day
  machine: string;         // «الماكينات»!J label
  reason: string;          // canonical key — translated to Arabic on the way in
  minutes: number;
  startedAt?: number;
  endedAt?: number | null;
  createdBy?: string;
  estimated?: boolean;
  notes?: string;
};

/**
 * Append one finished stoppage to «التوقفات».
 *
 * The ISO date is written as-is. Sheets parses ISO unambiguously in any locale,
 * and column A carries an explicit dd/mm/yyyy format from downtime-tab.gs, so
 * it renders zero-padded day-first — which is exactly the shape `normalizeDate`
 * resolves correctly by its padding tell. (Verified by round-tripping a row
 * through the live tab on 2026-08-14, because getting this wrong is how a month
 * of production once disappeared.)
 *
 * Minutes are REQUIRED and must be positive. The sheet validates !D > 0 for the
 * same reason this does: a stoppage recorded as zero reads as a machine that
 * never stopped, and this system has produced that particular lie more than
 * once. A caller with no minutes has nothing to write yet — it has an open
 * stoppage, which lives in Firestore until somebody stops it.
 */
export async function appendDowntimeRow(e: DowntimeRowInput): Promise<UpdateResult> {
  const minutes = Math.round(e.minutes);
  if (!(minutes > 0)) return { ok: false, reason: "no_minutes" };
  if (!e.date) return { ok: false, reason: "no_date" };
  if (!e.machine.trim()) return { ok: false, reason: "no_machine" };
  return appendRecord("downtime", {
    date: e.date,
    machine: e.machine.trim(),
    // The tab speaks Arabic. Retired keys («عطل», «خامة») keep their own
    // wording rather than collapsing into «أخرى» — they are 3,147 real minutes
    // of the migrated history and the Pareto should keep them apart. They are
    // simply not offered in the dropdown for new rows.
    reason: downtimeReasonAr(e.reason),
    minutes: String(minutes),
    start: e.startedAt ? formatClock(e.startedAt) : "",
    end: e.endedAt ? formatClock(e.endedAt) : "",
    estimated: e.estimated ? DOWNTIME_YES : DOWNTIME_NO,
    loggedBy: e.createdBy ?? "",
    notes: e.notes ?? "",
  });
}

/**
 * Identify one stoppage well enough to tell "not written yet" from "written,
 * but the bridge did not say so".
 *
 * Minute-precision start time, because that is all «التوقفات»!E stores. Two
 * genuinely distinct stoppages of the same machine, same length, starting in
 * the same minute do not exist — the capture allows only one open stoppage per
 * machine at a time.
 */
const downtimeFingerprint = (e: {
  date: string; machine: string; minutes: number; startedAt?: number;
}): string =>
  [e.date, e.machine.trim(), Math.round(e.minutes), formatClock(e.startedAt ?? 0)].join("|");

/**
 * Re-append stoppages whose row never landed.
 *
 * A stop is committed to Firestore before the bridge is asked for the row (see
 * `stopDowntimeEvent`), so a bridge that is throttled — it answers with an HTML
 * error page under load, which is a normal Tuesday here — leaves a closed event
 * with `sheetSynced: false` and no row. Without this, those minutes would
 * silently never appear in any total.
 *
 * ⚠ THE BRIDGE IS AT-LEAST-ONCE, NOT EXACTLY-ONCE. Measured on 2026-08-14 while
 * migrating the archive: an append that returned an HTML error page had already
 * written its row, and retrying gave one 14-minute stoppage two rows and 28
 * minutes. So a failed-looking write is NOT evidence that nothing happened, and
 * this reads the tab and skips anything whose fingerprint is already there.
 * Double-counted downtime is invisible — it just makes a machine look worse —
 * which is precisely why it is worth a read to prevent.
 *
 * Called from GET /api/downtime, which the floor page polls, so it heals itself
 * within a minute of the next person opening the page. Best-effort by design:
 * a failure here must never break the read that carried it.
 */
export async function flushPendingDowntime(): Promise<{
  flushed: number; failed: number; alreadyThere: number;
}> {
  let flushed = 0, failed = 0, alreadyThere = 0;
  let pending: DowntimeEvent[] = [];
  try {
    pending = await getPendingDowntimeEvents();
  } catch {
    return { flushed, failed, alreadyThere };
  }
  if (pending.length === 0) return { flushed, failed, alreadyThere };

  // `fresh` on purpose: a 45-second-old copy of the tab could be from before
  // the write whose fate is in question, which would reintroduce the duplicate
  // this check exists to stop.
  const existing = new Set(
    (await loadDowntimeRecords({ fresh: true }).catch(() => [])).map(downtimeFingerprint),
  );

  for (const e of pending) {
    // A stoppage rounded to zero minutes is a mis-tap, not a stoppage: !D
    // forbids a zero and inventing a 1 would be a measurement nobody made. The
    // Firestore document stays as the only record of the tap.
    if (!(e.minutes > 0)) {
      await markDowntimeSynced(e.id).catch(() => {});
      continue;
    }
    if (existing.has(downtimeFingerprint(e))) {
      // The row DID land; only the acknowledgement was lost.
      await markDowntimeSynced(e.id).catch(() => {});
      alreadyThere++;
      continue;
    }
    const res = await appendDowntimeRow({
      date: e.date,
      machine: e.machine,
      reason: e.reason,
      minutes: e.minutes,
      startedAt: e.startedAt,
      endedAt: e.endedAt,
      createdBy: e.createdBy,
      estimated: e.estimated,
    });
    if (res.ok) {
      await markDowntimeSynced(e.id).catch(() => {});
      existing.add(downtimeFingerprint(e));
      flushed++;
    } else {
      failed++;
      console.error(`[downtime] row for ${e.date} ${e.machine} still not written: ${res.reason}`);
    }
  }
  return { flushed, failed, alreadyThere };
}
