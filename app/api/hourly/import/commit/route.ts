import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-guard";
import { commitDraft, type CommitRow } from "@/lib/hourly-import";
import { HOURS_PER_SHIFT, type Shift } from "@/lib/sheet-import";

/**
 * POST /api/hourly/import/commit — write a confirmed draft into «تسجيل الإنتاج».
 *
 * The ONLY path from a photograph to the sheet, and it is reached only by an
 * explicit press on the preview. Open to any APPROVED role, same as the extract
 * route and the same as every other mutating route here — the assistant already
 * lets a shop-floor account write, with the actor taken from the verified token.
 * «تسجيل الإنتاج» has no notes column to stamp provenance into, so the actor is
 * recorded in the server log by `commitDraft()` rather than in the sheet.
 *
 * Everything the browser sends is re-derived server-side in `commitDraft()`
 * from a fresh read of the workbook. This route's own job is narrower: refuse
 * anything that is not the right SHAPE before it gets that far, so a malformed
 * payload can never reach the row matcher.
 */

const MAX_ROWS = 40; // one paper page covers every machine; the floor has ~14

function coerceCell(v: unknown): number | null | undefined {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined; // undefined ⇒ malformed, reject the request
}

export async function POST(req: NextRequest) {
  const g = await requireRole(req); // any APPROVED role — see the note above
  if ("deny" in g) return g.deny;

  let body: { date?: unknown; shift?: unknown; rows?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_json" }, { status: 400 });
  }

  const shift = String(body.shift ?? "") as Shift;
  if (shift !== "morning" && shift !== "evening") {
    return NextResponse.json({ ok: false, reason: "bad_shift" }, { status: 400 });
  }
  const date = String(body.date ?? "").trim();
  if (!date) return NextResponse.json({ ok: false, reason: "bad_date" }, { status: 400 });

  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return NextResponse.json({ ok: false, reason: "no_rows" }, { status: 400 });
  }
  if (body.rows.length > MAX_ROWS) {
    return NextResponse.json({ ok: false, reason: "too_many_rows" }, { status: 400 });
  }

  const rows: CommitRow[] = [];
  for (const raw of body.rows as Record<string, unknown>[]) {
    const hoursRaw = Array.isArray(raw?.hours) ? raw.hours : null;
    if (!hoursRaw || hoursRaw.length !== HOURS_PER_SHIFT) {
      return NextResponse.json({ ok: false, reason: "bad_hours_length" }, { status: 400 });
    }
    const hours = hoursRaw.map(coerceCell);
    if (hours.some((h) => h === undefined)) {
      return NextResponse.json({ ok: false, reason: "bad_hour_value" }, { status: 400 });
    }
    const actual = coerceCell(raw?.actualTotal);
    if (actual === undefined) {
      return NextResponse.json({ ok: false, reason: "bad_actual_value" }, { status: 400 });
    }
    const target = raw?.targetRow;
    const targetRow =
      target === null || target === undefined ? null
      : Number.isInteger(target) ? (target as number)
      : NaN;
    if (Number.isNaN(targetRow)) {
      return NextResponse.json({ ok: false, reason: "bad_target_row" }, { status: 400 });
    }
    rows.push({
      targetRow,
      machine: String(raw?.machine ?? ""),
      product: String(raw?.product ?? ""),
      hours: hours as (number | null)[],
      actualTotal: actual,
    });
  }

  try {
    const result = await commitDraft({ date, shift, rows }, g.user.email || g.user.uid);
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (err) {
    console.error("[hourly-import] commit failed", err);
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}
