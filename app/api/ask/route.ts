import { NextRequest } from "next/server";
import { requireRole } from "@/lib/api-guard";
import { isOnline } from "@/lib/ask";
import { askConfigured } from "@/lib/ask-crypto";
import { createQuestion, lastBeat, listThreads, usage } from "@/lib/ask-core";
import { askStore } from "@/lib/ask-store";
import { askJson, notConfigured, readQuestionBody, statusFor } from "@/lib/ask-guard";
import { resolveIssue } from "@/lib/ask-history";

/**
 * «اسأل Claude» — the staff side: my threads, and a new question.
 *
 *   GET  → { configured, online, lastBeatAt, cap, threads }
 *   POST → { text, photo?, issue? } → a new thread, status "waiting"
 *
 * The website never calls Claude: it stores the question, and a listener on
 * the owner's laptop answers it through /api/ask/listener/*. Owner, manager
 * and maintenance only (owner's word, 2026-10-10) — never a bare
 * requireRole(req), which would hand it to every approved role.
 *
 * Nothing here reads the body before the guard, and nothing here can block
 * logging an issue: the issues page does not call this until the person taps
 * «اسأل Claude».
 */
export async function GET(req: NextRequest) {
  const g = await requireRole(req, ["maintenance"]);
  if ("deny" in g) return g.deny;
  if (!askConfigured()) return askJson({ ok: true, configured: false, online: false, lastBeatAt: null, cap: null, threads: [] });
  try {
    const store = askStore();
    const who = { uid: g.user.uid, email: g.user.email, role: g.role };
    const now = Date.now();
    const [threads, cap, beatAt] = await Promise.all([
      listThreads(store, who, now),
      usage(store, who, now),
      lastBeat(store).catch(() => null),
    ]);
    return askJson({ ok: true, configured: true, online: isOnline(beatAt, now), lastBeatAt: beatAt, cap, threads });
  } catch (err) {
    console.error("[ask] list failed", err);
    return askJson({ ok: false, reason: "store_unavailable" }, 503);
  }
}

export async function POST(req: NextRequest) {
  const g = await requireRole(req, ["maintenance"]);
  if ("deny" in g) return g.deny;
  if (!askConfigured()) return notConfigured();
  const body = await readQuestionBody(req);
  if ("reason" in body) return askJson({ ok: false, reason: body.reason }, statusFor(body.reason));
  try {
    // Bounded inside: a slow sheet costs the verification, never the question.
    const issue = await resolveIssue(body.issue);
    const who = { uid: g.user.uid, email: g.user.email, role: g.role };
    const r = await createQuestion(askStore(), who, { text: body.text, photo: body.photo, issue });
    if (!r.ok) return askJson(r, statusFor(r.reason));
    console.log(`[ask] question ${r.thread.id} by ${who.email || who.uid}${issue ? ` (issue row ${issue.row})` : ""}`);
    return askJson(r);
  } catch (err) {
    console.error("[ask] create failed", err);
    return askJson({ ok: false, reason: "store_unavailable" }, 503);
  }
}
