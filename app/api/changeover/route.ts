import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-guard";
import { loadPlan, saveAnswers, recordMount, type AnswerItem } from "@/lib/changeover-data";

export type { ChangeoverResponse } from "@/lib/changeover-data";

/**
 * «خطة الاسطمبات» — which mould goes on which machine next (2026-09-30).
 *
 * GET   the machines, the open work orders and the engineer's standing
 *       answers, shaped; the page ranks them itself with lib/changeover.ts.
 * POST  `answers` — what the engineer just told the page (one row per thing
 *       asked about, appended to «إجابات خطة الاسطمبات»);
 *       `mount` — a confirmed change: one row in «تغييرات الاسطمبات», then the
 *       order's machine cell and the registry's product cell.
 *
 * PRODUCTION + owner/manager, both handlers: the rows name clients, orders
 * and quantities, and one tap here rewrites a work order's machine. Never a
 * bare requireRole(req) — the floor's `worker` role must not hold this button.
 */
export async function GET(req: NextRequest) {
  const g = await requireRole(req, ["production"]);
  if ("deny" in g) return g.deny;
  try {
    const fresh = new URL(req.url).searchParams.get("fresh") === "1";
    return NextResponse.json(await loadPlan({ fresh, role: g.role }));
  } catch (err) {
    console.error("[changeover]", err);
    return NextResponse.json({ ok: false, reason: "sheet_error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const g = await requireRole(req, ["production"]);
  if ("deny" in g) return g.deny;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const by = g.user.email;

    if (body.action === "answers") {
      const res = await saveAnswers((body.items ?? []) as AnswerItem[], by, g.role);
      return NextResponse.json(res, { status: res.ok ? 200 : res.status });
    }

    if (body.action === "mount") {
      const res = await recordMount({
        machine: String(body.machine ?? ""),
        order: String(body.order ?? ""),
        product: String(body.product ?? ""),
        colour: String(body.colour ?? ""),
        minutes: Number(body.minutes),
        reasons: String(body.reasons ?? ""),
        baseline: body.baseline === true,
      }, by);
      return NextResponse.json(res, { status: res.ok ? 200 : res.status });
    }

    return NextResponse.json({ ok: false, reason: "bad_action" }, { status: 400 });
  } catch (err) {
    console.error("[changeover]", err);
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}
