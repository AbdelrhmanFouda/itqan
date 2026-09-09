import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-guard";
import { updateRecord } from "@/lib/sheets";
import { normalizeDate } from "@/lib/dates";
import { hasProblem, sameIssue, ISSUE_CATEGORIES, ISSUE_STATUSES } from "@/lib/issues";
import { identityOf, loadIssues, readIssueInput, saveIssueAudio, ISSUE_TEXT_FIELDS } from "@/lib/issues-data";

/**
 * Edit one row of «الأعطال»: a status tap, a typed correction, or the
 * SOLUTION added after the fact — as text, as a voice note, or both.
 *
 * Body (multipart/form-data or JSON):
 *   changes  — the fields that changed (diff-only, never the whole row)
 *   expect   — the row as the client saw it: date + machine at least, plus
 *              product / description / issueAudio when it has them
 *   issueAudio / solutionAudio — optional files (multipart only)
 *
 * The row is re-located on a FRESH read and must still be the same issue
 * (lib/issues.ts sameIssue) or nothing is written — rows shift when anyone
 * deletes one in the sheet between the read and the tap, and a status
 * written onto a shifted row closes somebody else's fault. 409 on mismatch;
 * the page reloads the list and asks for the tap again.
 *
 * Any approved role: the worker who recorded the fault records the fix.
 */

const EDITABLE = new Set<string>(ISSUE_TEXT_FIELDS);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ row: string }> }) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  try {
    const { row: rowParam } = await params;
    const row = Number(rowParam);
    if (!Number.isFinite(row) || row < 2) return NextResponse.json({ ok: false, reason: "bad_row" }, { status: 400 });

    const input = await readIssueInput(req);
    if ("error" in input) return NextResponse.json({ ok: false, reason: input.error }, { status: input.status });
    if (!input.expect) return NextResponse.json({ ok: false, reason: "expect_required" }, { status: 400 });

    const fresh = await loadIssues({ fresh: true });
    const target = fresh.issues.find((i) => i.row === row);
    if (!target || !sameIssue(input.expect, identityOf(target))) {
      return NextResponse.json({ ok: false, reason: "row_changed" }, { status: 409 });
    }

    const changes: Record<string, string> = {};
    for (const [k, v] of Object.entries(input.changes)) {
      if (EDITABLE.has(k)) changes[k] = String(v ?? "").trim();
    }
    if (changes.status !== undefined && !(ISSUE_STATUSES as readonly string[]).includes(changes.status)) {
      return NextResponse.json({ ok: false, reason: "bad_status" }, { status: 400 });
    }
    if (changes.category !== undefined && changes.category && !(ISSUE_CATEGORIES as readonly string[]).includes(changes.category)) {
      return NextResponse.json({ ok: false, reason: "bad_category" }, { status: 400 });
    }
    if (changes.date !== undefined) changes.date = normalizeDate(changes.date) || target.date;

    for (const kind of ["issue", "solution"] as const) {
      const file = input.files[kind];
      if (!file) continue;
      const saved = await saveIssueAudio(kind, file, target.machine, target.date);
      if (!saved.ok) return NextResponse.json({ ok: false, reason: saved.reason }, { status: saved.status });
      changes[kind === "issue" ? "issueAudio" : "solutionAudio"] = saved.link;
    }

    // An issue may lose its text only while it keeps a recording of the problem.
    const description = changes.description ?? target.description;
    const keepsAudio = Boolean(changes.issueAudio || target.issueAudio);
    if (!hasProblem(description, keepsAudio)) {
      return NextResponse.json({ ok: false, reason: "description_required" }, { status: 400 });
    }

    // Diff against the row as it is NOW, not as the client remembered it.
    const before = { ...target, issueAudio: target.issueAudio?.url ?? "", solutionAudio: target.solutionAudio?.url ?? "" } as Record<string, unknown>;
    for (const k of Object.keys(changes)) {
      if (String(before[k] ?? "") === changes[k]) delete changes[k];
    }
    if (Object.keys(changes).length === 0) return NextResponse.json({ ok: true, unchanged: true });

    const res = await updateRecord("issues", row, changes);
    if (res.ok) {
      console.log(
        `[issues] row ${row} (${target.date} ${target.machine || "—"}) ` +
          `${Object.keys(changes).join(", ")} by ${g.user.email || g.user.uid}`,
      );
    }
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}
