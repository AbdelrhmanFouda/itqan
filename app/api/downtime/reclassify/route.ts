import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-guard";
import { updateRecord } from "@/lib/sheets";
import { loadDowntimeRecords } from "@/lib/downtime-data";
import { DOWNTIME_CAPTURE_REASONS, downtimeReasonAr } from "@/lib/prod-meta";

/**
 * Owner review: re-label «أخرى» stoppages with their real reason.
 *
 * «أخرى» reached 25 of 54 rows in Aug 2026 — including the largest events —
 * which makes the Pareto useless exactly where it matters. The floor flow is
 * untouchable (four taps, no questions), so the correction happens HERE,
 * after the fact, by the owner: pick a row, pick the real reason, one cell is
 * written.
 *
 * OWNER/MANAGER ONLY (the empty allow-list): this is a review action that
 * rewrites history, not a floor action.
 *
 *   GET  → the «أخرى» rows, newest first
 *   POST → { row, date, machine, minutes, reason } — the identity fields are
 *          verified against a FRESH read before writing, because rows shift if
 *          anyone deletes one between the list and the tap.
 *
 * ⚠ The write goes through `updates` (setValue), which ENFORCES the sheet's
 * dropdown validation on «سبب التوقف». The three reasons added 2026-08-27 are
 * not in that dropdown until the owner extends it — reclassifying to one of
 * them returns `cell_rejected` cleanly rather than corrupting the row.
 */

const VALID = new Set(DOWNTIME_CAPTURE_REASONS.map((r) => r.key).filter((k) => k !== "Other"));

export async function GET(req: NextRequest) {
  const g = await requireRole(req, []);
  if ("deny" in g) return g.deny;
  try {
    const rows = await loadDowntimeRecords();
    return NextResponse.json({
      rows: rows
        .filter((r) => r.reason === "Other")
        .map((r) => ({
          row: r.row, date: r.date, machine: r.machine,
          minutes: r.minutes, notes: r.notes,
        })),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ rows: [] });
  }
}

export async function POST(req: NextRequest) {
  const g = await requireRole(req, []);
  if ("deny" in g) return g.deny;
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const row = Number(b.row);
    const reason = String(b.reason ?? "");
    if (!VALID.has(reason)) {
      return NextResponse.json({ ok: false, reason: "bad_reason" }, { status: 400 });
    }

    // Re-locate on a fresh read: the row must still be the SAME stoppage
    // (date + machine + minutes) and still «أخرى». Anything else refuses —
    // writing a reason onto a shifted row would corrupt a different stoppage.
    const fresh = await loadDowntimeRecords({ fresh: true });
    const target = fresh.find((r) => r.row === row);
    if (
      !target ||
      target.reason !== "Other" ||
      target.date !== String(b.date ?? "") ||
      target.machine !== String(b.machine ?? "") ||
      target.minutes !== Number(b.minutes)
    ) {
      return NextResponse.json({ ok: false, reason: "row_changed" }, { status: 409 });
    }

    const res = await updateRecord("downtime", row, { reason: downtimeReasonAr(reason) });
    if (res.ok) {
      console.log(
        `[downtime] row ${row} (${target.date} ${target.machine}) reclassified ` +
          `«أخرى» → ${reason} by ${g.user.email || g.user.uid}`,
      );
    }
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}
