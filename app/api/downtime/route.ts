import { NextRequest, NextResponse } from "next/server";
import {
  getOpenDowntimeEvents,
  addDowntimeEvent,
  stopDowntimeEvent,
  markDowntimeSynced,
} from "@/lib/db";
import { requireRole } from "@/lib/api-guard";
import { factoryDay } from "@/lib/dates";
import { isStaleOpen } from "@/lib/downtime";
import {
  loadDowntimeRecords, appendDowntimeRow, flushPendingDowntime,
} from "@/lib/downtime-data";
import { DOWNTIME_CAPTURE_REASONS } from "@/lib/prod-meta";

/**
 * Downtime capture.
 *
 *   GET    → the still-running stoppages + today's finished ones
 *   POST   → start a stoppage  { machine, reason }
 *   PATCH  → stop one          { id }
 *
 * ── Two stores, one job each (settled 2026-08-14) ─────────────────────────
 * The LOG is the sheet tab «التوقفات» — it is what every total, chart and
 * report reads. Firestore holds only the stoppage that is running right now,
 * because a running stoppage has no minutes and «التوقفات»!D is validated
 * greater than zero: there is no legal row for it, and writing one as 0 "to be
 * fixed later" is exactly the failure this system keeps producing. The row is
 * appended the moment somebody taps stop, always with measured minutes.
 *
 * The phone flow is untouched by any of this: machine → reason → start → stop,
 * four taps, no typing.
 *
 * Every verb is guarded. Unlike the other operational reads, GET is NOT left
 * open: the rows carry «سُجل بواسطة» (a staff email), so the read is treated
 * like the other PII reads.
 *
 * The client never sends a date, a start time or a duration. The server stamps
 * the start, and `stopDowntimeEvent()` computes the minutes from the STORED
 * start — a phone with a wrong clock (or a hostile caller) cannot invent
 * downtime that would then flow into Availability.
 */

const REASON_KEYS = new Set(DOWNTIME_CAPTURE_REASONS.map((r) => r.key));

export async function GET(req: NextRequest) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  const today = factoryDay();
  try {
    // Any stop whose row did not reach the sheet gets another go first, so the
    // list below shows it. Best-effort — a failure here must not take the read
    // down with it.
    await flushPendingDowntime().catch(() => null);
    const [rows, open] = await Promise.all([
      loadDowntimeRecords(),
      getOpenDowntimeEvents(),
    ]);
    return NextResponse.json({
      open: open.filter((e) => !isStaleOpen(e, today)),   // running now, this shift
      stale: open.filter((e) => isStaleOpen(e, today)),   // never stopped, day is over
      today: rows.filter((e) => e.date === today),        // from «التوقفات»
      todayDate: today,
      // Newest row in «التوقفات» (rows are sorted newest first) — the dashboard
      // home turns this into "days since the last stoppage was logged", because
      // capture going quiet looked exactly like nothing breaking until someone
      // checked the tab by hand (silent 24→27 Aug 2026 before this existed).
      lastLoggedDate: rows[0]?.date ?? "",
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ open: [], stale: [], today: [], todayDate: today });
  }
}

export async function POST(req: NextRequest) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const machine = String(b.machine ?? "").trim();
    const reason = String(b.reason ?? "").trim();
    if (!machine) return NextResponse.json({ ok: false, reason: "no_machine" }, { status: 400 });
    if (!REASON_KEYS.has(reason)) {
      return NextResponse.json({ ok: false, reason: "bad_reason" }, { status: 400 });
    }

    // One running stoppage per machine. A double-tapped start (or a second
    // phone) returns the event already running instead of opening a duplicate
    // that would double-count the machine's downtime.
    const already = (await getOpenDowntimeEvents()).find((e) => e.machine === machine);
    if (already) return NextResponse.json({ ok: true, event: already, already: true });

    // Nothing is written to the sheet here. The stoppage has no minutes yet;
    // the row appears on stop.
    const event = await addDowntimeEvent({
      date: factoryDay(),           // the 08:00→07:00 factory day, not the calendar day
      machine,
      reason,
      minutes: 0,
      startedAt: Date.now(),
      endedAt: null,
      createdBy: g.user.email || g.user.uid,
      estimated: false, // a tapped stop measures; only a later review estimates
      closedBy: "",
    });
    return NextResponse.json({ ok: true, event, already: false });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const id = String(b.id ?? "").trim();
    if (!id) return NextResponse.json({ ok: false, reason: "no_id" }, { status: 400 });
    const actor = g.user.email || g.user.uid;

    let res: Awaited<ReturnType<typeof stopDowntimeEvent>>;
    if (b.estimate === true) {
      /**
       * Closing a stoppage nobody stopped. A REVIEW action — a person is looking
       * at it and deciding — so it is flagged «تقديري؟ = نعم» for good, and
       * nothing in the system does it automatically.
       *
       * ── THE SHIFT DOES NOT END THE STOPPAGE (owner's rule, 2026-08-17) ────
       * This used to cap the minutes at `factoryDayEnd(ev.date)` — 08:00 the
       * next morning — on the reasoning that a machine "cannot have been down
       * past the shift it was logged in". That reasoning was wrong, and the
       * data says so: **21 of the 37 captured stoppages already run past 08:00,
       * and they are 14,973 of the 17,253 minutes.** A press that broke at
       * 22:00 and was still broken at 14:00 was down for sixteen hours; it did
       * not start running again because a shift ended and nobody was there.
       *
       * So there is no cap. The stoppage runs to NOW, which is
       * `stopDowntimeEvent`'s default — the same clock a tapped stop uses, and
       * computed server-side from the STORED start either way, so a phone with
       * a wrong clock still cannot invent downtime.
       *
       * What keeps a forgotten tap from inventing days is not a cap, it is
       * `isStaleOpen()` surfacing it to the owner the morning after — and the
       * `estimated` flag, which keeps a reconstruction out of any sentence that
       * claims something was measured.
       */
      const ev = (await getOpenDowntimeEvents()).find((e) => e.id === id);
      if (!ev) return NextResponse.json({ ok: false, reason: "not_open" }, { status: 404 });
      res = await stopDowntimeEvent(id, { estimated: true, closedBy: actor });
    } else {
      res = await stopDowntimeEvent(id);
    }

    if (!res.ok) return NextResponse.json(res, { status: 404 });
    // A double-tapped stop already has its row (or its pending retry) — writing
    // again would give one stoppage two rows and double its minutes.
    if (res.already) return NextResponse.json({ ...res, event: undefined });

    const e = res.event;
    // A stoppage that rounds to zero minutes is a mis-tap. !D forbids a zero and
    // rounding it up to 1 would invent a measurement, so nothing is written and
    // the Firestore document stays as the only record of the tap.
    if (!e || !(e.minutes > 0)) {
      if (e) await markDowntimeSynced(e.id).catch(() => {});
      return NextResponse.json({ ok: true, minutes: res.minutes, already: false });
    }

    const write = await appendDowntimeRow({
      date: e.date,
      machine: e.machine,
      reason: e.reason,
      minutes: e.minutes,
      startedAt: e.startedAt,
      endedAt: e.endedAt,
      createdBy: e.createdBy,
      estimated: e.estimated,
    });
    if (write.ok) {
      await markDowntimeSynced(e.id).catch(() => {});
    } else {
      // The stop is safe in Firestore with sheetSynced:false and will be
      // retried on the next GET — the minutes are not lost. Loud, because
      // "the bridge is refusing writes" is not something to discover from a
      // total that quietly stopped growing.
      console.error(
        `[downtime] stop recorded but «التوقفات» row not written for ${e.date} ${e.machine}: ${write.reason}`,
      );
    }
    return NextResponse.json({
      ok: true,
      minutes: res.minutes,
      already: false,
      estimated: e.estimated,
      /** false ⇒ the row is queued for retry, not lost. */
      written: write.ok,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}
