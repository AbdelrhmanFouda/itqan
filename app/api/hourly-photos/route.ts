import { NextRequest, NextResponse } from "next/server";
import { getHourlyPhotos, addHourlyPhoto, getHourlyPhoto, deleteHourlyPhoto } from "@/lib/db";
import { requireRole } from "@/lib/api-guard";
import { factoryDay } from "@/lib/dates";
import { isValidPhotoPath, PHOTO_MAX_BYTES } from "@/lib/photos";

/**
 * Metadata for photos of the PAPER hourly log sheet.
 *
 *   GET    ?date=YYYY-MM-DD → that day's photos
 *   POST   { date, machine, path, url, sizeBytes } → record one
 *   DELETE ?id=… → forget one
 *
 * The image bytes never pass through here. The browser uploads them straight to
 * Firebase Storage as the signed-in user (lib/photo-upload.ts), so the Storage
 * rules see a real `request.auth`; this route only writes the record and stamps
 * WHO took it from the verified token — never from the body.
 *
 * Guarded, including the read: the rows carry `createdBy`, same as
 * /api/downtime.
 */

export async function GET(req: NextRequest) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  const date = req.nextUrl.searchParams.get("date") || factoryDay();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ ok: false, reason: "bad_date" }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, date, photos: await getHourlyPhotos(date) });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: true, date, photos: [] });
  }
}

export async function POST(req: NextRequest) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const date = String(b.date ?? "").trim();
    const machine = String(b.machine ?? "").trim();
    const path = String(b.path ?? "").trim();
    const url = String(b.url ?? "").trim();
    const sizeBytes = Number(b.sizeBytes ?? 0);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ ok: false, reason: "bad_date" }, { status: 400 });
    }
    if (!machine) return NextResponse.json({ ok: false, reason: "no_machine" }, { status: 400 });
    // The path is generated client-side, so it is checked rather than trusted.
    if (!isValidPhotoPath(path)) {
      return NextResponse.json({ ok: false, reason: "bad_path" }, { status: 400 });
    }
    if (!url.startsWith("https://")) {
      return NextResponse.json({ ok: false, reason: "bad_url" }, { status: 400 });
    }
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > PHOTO_MAX_BYTES) {
      return NextResponse.json({ ok: false, reason: "bad_size" }, { status: 400 });
    }

    const photo = await addHourlyPhoto({
      date, machine, path, url, sizeBytes,
      createdBy: g.user.email || g.user.uid,
    });
    return NextResponse.json({ ok: true, photo });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const g = await requireRole(req);
  if ("deny" in g) return g.deny;
  const id = req.nextUrl.searchParams.get("id") || "";
  if (!id) return NextResponse.json({ ok: false, reason: "no_id" }, { status: 400 });
  try {
    // Return the path so the caller can drop the Storage object too — it can do
    // that as the signed-in user, which this server cannot.
    const existing = await getHourlyPhoto(id);
    if (!existing) return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
    await deleteHourlyPhoto(id);
    return NextResponse.json({ ok: true, path: existing.path });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}
