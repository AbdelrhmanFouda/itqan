import { NextRequest, NextResponse } from "next/server";
import { getRecords } from "@/lib/sheets";
import { validateIssue, logIssue, newToolCtx, type ProposedIssue } from "@/lib/agent-tools";
import { requireRole } from "@/lib/api-guard";

// «الأعطال» faults log — list + create. Uses the SAME validation the AI agent
// uses (machine label vs registry, product vs Master), and logIssue's
// self-healing append (creates the tab through the bridge if it's missing).
// Status/field edits go through the generic PATCH /api/sheet/issues.

function s(v: string | undefined): string {
  return (v ?? "").trim();
}

export async function GET() {
  try {
    const { records, writable } = await getRecords("issues");
    const issues = records.map((r) => ({
      row: r.row,
      date: s(r.date),
      machine: s(r.machine),
      product: s(r.product),
      category: s(r.category),
      description: s(r.description),
      action: s(r.action),
      status: s(r.status) || "مفتوح",
      note: s(r.note),
    }));
    // Newest first (rows append chronologically; date text can be mixed shapes).
    issues.reverse();
    // Open operational read — browsers may reuse it briefly; error responses
    // deliberately carry no cache header.
    return NextResponse.json({ issues, writable }, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "sheet error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  try {
    const b = (await req.json()) as ProposedIssue;
    const v = await validateIssue(b, newToolCtx());
    if (v.errors.length > 0) {
      return NextResponse.json({ ok: false, errors: v.errors }, { status: 400 });
    }
    const r = await logIssue(v.values);
    if (!r.ok) return NextResponse.json({ ok: false, reason: r.reason }, { status: 400 });
    return NextResponse.json({ ok: true, warnings: v.warnings });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "sheet error" }, { status: 500 });
  }
}
