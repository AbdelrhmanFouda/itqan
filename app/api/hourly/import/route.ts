import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-guard";
import { readSheetPhoto } from "@/lib/sheet-vision";
import { buildDraft } from "@/lib/hourly-import";

/**
 * POST /api/hourly/import — read a photographed paper production sheet.
 *
 * Guarded, and open to ANY APPROVED ROLE — the same rule the rest of the app's
 * mutating routes use, and the same one that already lets a shop-floor account
 * drive the assistant. The owner asked for one page that looks the same for
 * everyone (2026-08-10), so the button is not role-gated and this must not be
 * either; a visible control that 401s is worse than no control.
 *
 * ⚠️ This is the only route in the app that spends a VISION call per request,
 * and the Gemini free tier rate-limits: a 429 was hit during testing on
 * 2026-08-10. Several people photographing at shift change will see
 * `vision_failed`. It degrades safely — nothing is written and the UI says so —
 * but if that becomes common, add a per-user daily cap the way /api/agent does
 * (`AI_AGENT_DAILY_LIMIT` + the Firestore `usage/{uid}` counter).
 *
 * The photo is read and DISCARDED. Nothing is stored — not in Firestore, not in
 * a bucket. Firebase Storage was tried and deliberately abandoned; the owner's
 * instruction was "send the image straight to Gemini and never store it".
 *
 * This route WRITES NOTHING. It returns a draft to correct;
 * POST /api/hourly/import/commit is the only path to the sheet.
 */

/**
 * A vision call on a full page takes 20–30 s measured, and the platform's
 * default function timeout is well under that on some plans — which would kill
 * the request mid-read and surface as an unexplained failure. Ask for headroom
 * explicitly rather than depending on whatever the default happens to be.
 */
export const maxDuration = 60;

// A phone photo compressed client-side lands around 300–600 KB → ~800 KB of
// base64. The client now caps itself at 3.5M chars; this stays above that so a
// legitimate payload is never rejected here, while still refusing megabytes.
const MAX_BASE64_CHARS = 8_000_000;

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

export async function POST(req: NextRequest) {
  const g = await requireRole(req); // any APPROVED role — see the note above
  if ("deny" in g) return g.deny;

  let body: { imageBase64?: unknown; mimeType?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_json" }, { status: 400 });
  }

  const mimeType = String(body.mimeType ?? "").toLowerCase();
  if (!ALLOWED_MIME.has(mimeType)) {
    return NextResponse.json({ ok: false, reason: "bad_mime" }, { status: 400 });
  }

  // Accept a data: URL too — it is what a FileReader hands back, and stripping
  // it here is cheaper than getting it wrong in three places on the client.
  let base64 = String(body.imageBase64 ?? "");
  const comma = base64.indexOf(",");
  if (base64.startsWith("data:") && comma > 0) base64 = base64.slice(comma + 1);
  base64 = base64.trim();

  if (!base64) return NextResponse.json({ ok: false, reason: "no_image" }, { status: 400 });
  if (base64.length > MAX_BASE64_CHARS) {
    return NextResponse.json({ ok: false, reason: "image_too_large" }, { status: 413 });
  }

  try {
    const vision = await readSheetPhoto(base64, mimeType);
    if (!vision.ok) {
      // no_provider is a configuration answer, not a server fault — say so with
      // a 200 so the UI can show "no key configured" rather than "it broke".
      const status = vision.reason === "no_provider" ? 200 : 502;
      return NextResponse.json({ ok: false, reason: vision.reason, detail: vision.detail }, { status });
    }
    const draft = await buildDraft(vision);
    return NextResponse.json(draft, { status: draft.ok ? 200 : 422 });
  } catch (err) {
    console.error("[hourly-import] extract failed", err);
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}
