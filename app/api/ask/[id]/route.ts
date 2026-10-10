import { NextRequest } from "next/server";
import { requireRole } from "@/lib/api-guard";
import { isOnline } from "@/lib/ask";
import { askConfigured } from "@/lib/ask-crypto";
import { followUp, lastBeat, readThread, retryQuestion } from "@/lib/ask-core";
import { askStore } from "@/lib/ask-store";
import { askJson, notConfigured, readQuestionBody, statusFor } from "@/lib/ask-guard";

/**
 * One «اسأل Claude» thread.
 *
 *   GET  → { thread, online, lastBeatAt } — what the chat screen polls
 *   POST → { text, photo? }  a follow-up in the same thread
 *          { retry: true }   the same question again, after a failed answer
 *
 * A thread is its asker's; owner and manager may read any. Only the asker
 * writes into it. Neither verb touches the sheet.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireRole(req, ["maintenance"]);
  if ("deny" in g) return g.deny;
  if (!askConfigured()) return notConfigured();
  const { id } = await params;
  try {
    const store = askStore();
    const now = Date.now();
    const who = { uid: g.user.uid, email: g.user.email, role: g.role };
    const [thread, beatAt] = await Promise.all([readThread(store, who, id, now), lastBeat(store).catch(() => null)]);
    if (!thread) return askJson({ ok: false, reason: "not_found" }, 404);
    return askJson({ ok: true, thread, mine: thread.askedByUid === who.uid, online: isOnline(beatAt, now), lastBeatAt: beatAt });
  } catch (err) {
    console.error("[ask] read failed", err);
    return askJson({ ok: false, reason: "store_unavailable" }, 503);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireRole(req, ["maintenance"]);
  if ("deny" in g) return g.deny;
  if (!askConfigured()) return notConfigured();
  const body = await readQuestionBody(req);
  if ("reason" in body) return askJson({ ok: false, reason: body.reason }, statusFor(body.reason));
  const { id } = await params;
  try {
    const who = { uid: g.user.uid, email: g.user.email, role: g.role };
    const r = body.retry
      ? await retryQuestion(askStore(), who, id)
      : await followUp(askStore(), who, id, { text: body.text, photo: body.photo });
    return askJson(r, r.ok ? 200 : statusFor(r.reason));
  } catch (err) {
    console.error("[ask] follow-up failed", err);
    return askJson({ ok: false, reason: "store_unavailable" }, 503);
  }
}
