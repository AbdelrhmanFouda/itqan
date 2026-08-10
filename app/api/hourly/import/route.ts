import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-guard";
import { readSheetPhoto } from "@/lib/sheet-vision";
import { buildDraft } from "@/lib/hourly-import";

/**
 * POST /api/hourly/import — read a photographed paper production sheet.
 *
 * Guarded, and to owner/manager only. This is the OWNER's review surface, not a
 * shop-floor one: the crew's page is «تسجيل الإنتاج» as a read-only view and
 * the four-tap downtime page, and neither may gain a step. It is also the only
 * route in the app that spends a vision call per request, so it is not left
 * open the way the operational reads are.
 *
 * The photo is read and DISCARDED. Nothing is stored — not in Firestore, not in
 * a bucket. Firebase Storage was tried and deliberately abandoned; the owner's
 * instruction was "send the image straight to Gemini and never store it".
 *
 * This route WRITES NOTHING. It returns a draft for the owner to correct;
 * POST /api/hourly/import/commit is the only path to the sheet.
 */

// A phone photo compressed client-side lands around 300–600 KB → ~800 KB of
// base64. This cap is generous enough for an uncompressed capture that slipped
// through and small enough that the route cannot be used to push megabytes.
const MAX_BASE64_CHARS = 8_000_000;

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

export async function POST(req: NextRequest) {
  const g = await requireRole(req, []); // [] ⇒ owner/manager only (hasFullAccess)
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
