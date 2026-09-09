import { NextRequest, NextResponse } from "next/server";
import { bridgeFeatures } from "@/lib/sheets";
import { validateIssue, logIssue, newToolCtx } from "@/lib/agent-tools";
import { requireRole } from "@/lib/api-guard";
import { loadIssues, readIssueInput, saveIssueAudio } from "@/lib/issues-data";

// «الأعطال» faults log — list + create. Uses the SAME validation the AI agent
// uses (machine label vs registry, product vs Master), and logIssue's
// self-healing append (creates the tab through the bridge if it's missing).
//
// Since 2026-09-09 a new issue may carry VOICE NOTES instead of typed text:
// POST accepts multipart/form-data with the text fields plus `issueAudio` /
// `solutionAudio` files (JSON still works for text-only callers). Each file
// is saved to the owner's Drive through the bridge BEFORE the row is
// appended, so a row never links to a recording that failed to save; the
// row then holds the Drive links in «تسجيل العطل» / «تسجيل الحل».
// Edits (fields, status, adding a solution) go through PATCH /api/issues/[row],
// which verifies the row's identity on a fresh read first.

export async function GET() {
  try {
    const [{ issues, writable }, features] = await Promise.all([loadIssues(), bridgeFeatures()]);
    // Newest first (rows append chronologically; date text can be mixed shapes).
    issues.reverse();
    // `audio.supported` tells the page whether the DEPLOYED bridge can take a
    // recording; until the owner deploys the version with `saveAudio`, the
    // microphone stays hidden and the page is exactly what it was.
    // Open operational read — browsers may reuse it briefly; error responses
    // deliberately carry no cache header.
    return NextResponse.json(
      { issues, writable, audio: { supported: features.audio } },
      { headers: { "Cache-Control": "private, max-age=30" } },
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "sheet error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  try {
    const input = await readIssueInput(req);
    if ("error" in input) return NextResponse.json({ ok: false, reason: input.error }, { status: input.status });

    const hasAudio = Boolean(input.files.issue);
    const v = await validateIssue(input.fields, newToolCtx(), { audio: hasAudio });
    if (v.errors.length > 0) {
      return NextResponse.json({ ok: false, reason: "description_required", errors: v.errors }, { status: 400 });
    }

    // Recordings first, row second: a failed upload leaves nothing in the
    // sheet, and the user simply tries again.
    const values: Record<string, string> = { ...v.values };
    for (const kind of ["issue", "solution"] as const) {
      const file = input.files[kind];
      if (!file) continue;
      const saved = await saveIssueAudio(kind, file, values.machine, values.date);
      if (!saved.ok) return NextResponse.json({ ok: false, reason: saved.reason }, { status: saved.status });
      values[kind === "issue" ? "issueAudio" : "solutionAudio"] = saved.link;
    }

    const r = await logIssue(values);
    if (!r.ok) return NextResponse.json({ ok: false, reason: r.reason }, { status: 400 });
    console.log(
      `[issues] logged ${values.date} ${values.machine || "—"} by ${g.user.email || g.user.uid}` +
        `${values.issueAudio ? " (voice)" : ""}${values.solutionAudio ? " (+solution voice)" : ""}`,
    );
    return NextResponse.json({ ok: true, warnings: v.warnings });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "sheet error" }, { status: 500 });
  }
}
