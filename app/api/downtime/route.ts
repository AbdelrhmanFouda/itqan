import { NextRequest, NextResponse } from "next/server";
import {
  getDowntimeEvents,
  getOpenDowntimeEvents,
  addDowntimeEvent,
  stopDowntimeEvent,
} from "@/lib/db";
import { requireRole } from "@/lib/api-guard";
import { factoryDay } from "@/lib/dates";
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
  try {
    const all = await getDowntimeEvents();
    const open = all.filter((e) => e.endedAt == null);
    const today = factoryDay();
    return NextResponse.json({
      open,
      today: all.filter((e) => e.date === today && e.endedAt != null),
      recent: all.slice(0, 100),
      todayDate: today,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ open: [], today: [], recent: [], todayDate: factoryDay() });
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
    const res = await stopDowntimeEvent(id);
    return NextResponse.json(res, { status: res.ok ? 200 : 404 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}
