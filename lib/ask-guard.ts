/**
 * «اسأل Claude» — the listener's door.
 *
 * The laptop that answers is not a Firebase user. It carries ONE long secret,
 * `ASK_LISTENER_TOKEN`, as a Bearer header. It is its own env var on purpose:
 * never the main bridge key (written in apps-script.gs, and the repo was found
 * public on 2026-09-28), never the storage one.
 *
 * Unset, short, or with the data key missing, every listener route answers
 * 503 `not_configured` — a missing secret must never read as "open".
 */
import { NextRequest, NextResponse } from "next/server";
import { listenerTokenOk } from "@/lib/ask";
import { askConfigured } from "@/lib/ask-crypto";

export type ListenerGuard = { ok: true } | { deny: NextResponse };

export function requireListener(req: NextRequest): ListenerGuard {
  if (!askConfigured()) {
    return { deny: NextResponse.json({ ok: false, reason: "not_configured" }, { status: 503 }) };
  }
  const h = req.headers.get("authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!listenerTokenOk(token, process.env.ASK_LISTENER_TOKEN)) {
    return { deny: NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 }) };
  }
  return { ok: true };
}

/** The staff routes' answer when the two secrets are not set. */
export function notConfigured(): NextResponse {
  return NextResponse.json({ ok: false, reason: "not_configured" }, { status: 503 });
}

/** One no-store JSON answer; a thread is never shared-cacheable. */
export function askJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** HTTP status for a refusal reason. */
export function statusFor(reason: string): number {
  switch (reason) {
    case "not_found": return 404;
    case "daily_cap": return 429;
    case "already_claimed": case "not_waiting": case "claim_lost": case "already_answered":
    case "still_waiting": case "retry_first": case "not_failed": case "thread_full":
      return 409;
    case "photo_too_large": return 413;
    default: return 400;
  }
}

/** The largest JSON body a question may be: the photo as base64, plus text. */
const MAX_BODY_CHARS = 900_000;

export type QuestionBody = { text: string; photo: Uint8Array | null; issue: unknown; retry: boolean };

/**
 * A question as the page posts it: JSON `{ text, photo?, issue?, retry? }`,
 * `photo` being the resized JPEG as base64 (a data URL is accepted too).
 * Call it AFTER the role guard.
 */
export async function readQuestionBody(req: NextRequest): Promise<QuestionBody | { reason: string }> {
  let raw = "";
  try {
    raw = await req.text();
  } catch {
    return { reason: "bad_body" };
  }
  if (raw.length > MAX_BODY_CHARS) return { reason: "photo_too_large" };
  let b: Record<string, unknown>;
  try {
    b = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { reason: "bad_body" };
  }
  if (!b || typeof b !== "object") return { reason: "bad_body" };
  let photo: Uint8Array | null = null;
  if (typeof b.photo === "string" && b.photo) {
    const b64 = b.photo.replace(/^data:image\/jpeg;base64,/, "");
    if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) return { reason: "bad_photo" };
    photo = new Uint8Array(Buffer.from(b64, "base64"));
  }
  return { text: String(b.text ?? ""), photo, issue: b.issue ?? null, retry: b.retry === true };
}
