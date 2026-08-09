import { NextRequest, NextResponse } from "next/server";
import {
  getDowntimeEventsBetween,
  getOpenDowntimeEvents,
  addDowntimeEvent,
  stopDowntimeEvent,
} from "@/lib/db";
import { requireRole } from "@/lib/api-guard";
import { factoryDay, factoryDayEnd } from "@/lib/dates";
import { isStaleOpen } from "@/lib/downtime";
import { DOWNTIME_CAPTURE_REASONS } from "@/lib/prod-meta";

/**
 * PHASE 2 — downtime capture (Firestore `downtimeEvents`, NOT the sheet).
 *
 *   GET    → the still-running stoppages + recent history
 *   POST   → start a stoppage  { machine, reason }
 *   PATCH  → stop one          { id }
 *
 * Every verb is guarded. Unlike the other operational reads, GET is NOT left
 * open: these documents carry `createdBy` (a staff email), so the read is
 * treated like the other PII reads.
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
    // Bounded: today's rows for the day list, plus the (tiny) open-event query.
    // Never the whole collection — see getDowntimeEventsBetween.
    const [todayRows, open] = await Promise.all([
      getDowntimeEventsBetween(today, today),
      getOpenDowntimeEvents(),
    ]);
    return NextResponse.json({
      open: open.filter((e) => !isStaleOpen(e, today)),   // running now, this shift
      stale: open.filter((e) => isStaleOpen(e, today)),   // never stopped, day is over
      today: todayRows.filter((e) => e.endedAt != null),
      todayDate: today,
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

    // Closing a stoppage nobody stopped. This is a REVIEW action — a person is
    // looking at it and deciding — so the minutes may inform Availability, but
    // the row is flagged `estimated` for good and capped at the end of its own
    // factory day. Nothing in the system closes these on its own.
    if (b.estimate === true) {
      const ev = (await getOpenDowntimeEvents()).find((e) => e.id === id);
      if (!ev) return NextResponse.json({ ok: false, reason: "not_open" }, { status: 404 });
      const endedAt = factoryDayEnd(ev.date);
      if (!endedAt || endedAt <= ev.startedAt) {
        return NextResponse.json({ ok: false, reason: "bad_day" }, { status: 400 });
      }
      const res = await stopDowntimeEvent(id, {
        endedAt,
        estimated: true,
        closedBy: g.user.email || g.user.uid,
      });
      return NextResponse.json({ ...res, estimated: true }, { status: res.ok ? 200 : 404 });
    }

    const res = await stopDowntimeEvent(id);
    return NextResponse.json(res, { status: res.ok ? 200 : 404 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}
