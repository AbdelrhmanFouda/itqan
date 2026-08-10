/**
 * Photos of the paper hourly log. Pure helpers, no imports — same rule as
 * lib/oee.ts and lib/downtime.ts, so the path and size logic is unit-testable
 * without Firebase.
 *
 * WHY THIS EXISTS. «تسجيل الإنتاج» is typed up from a paper sheet the crew fills
 * in at the machine. Between the paper being filled and somebody typing it, the
 * record exists on one piece of paper in a workshop. A photo is a safety net: if
 * the paper is lost, smudged or never typed, the numbers are still recoverable,
 * and the typed row can be checked against what was actually written.
 *
 * It is keyed to DAY + MACHINE because that is exactly the shape of a
 * «تسجيل الإنتاج» row — one row per machine per day, 24 hour columns across it.
 *
 * The image bytes live in Firebase Storage; only metadata goes in Firestore.
 * A photo is 200–500 KB after compression, and Firestore documents cap at 1 MiB
 * — storing images as base64 in the document would both risk that ceiling and
 * drag every image through every list query.
 */

/** Long edge, in pixels, after client-side downscaling.
 *  A log sheet has to stay READABLE — this is a document, not a thumbnail, so it
 *  is deliberately larger than you would pick for a photo of an object. */
export const PHOTO_MAX_EDGE = 1600;

/** JPEG quality after downscaling. */
export const PHOTO_QUALITY = 0.75;

/** Refuse anything above this AFTER compression — a guard against a pathological
 *  file, not a normal limit. A 1600px sheet lands around 200–500 KB. */
export const PHOTO_MAX_BYTES = 4 * 1024 * 1024;

export const PHOTO_ACCEPT = "image/*";

/**
 * A machine label ("PQ 7 — 100") turned into a safe path segment ("pq-7-100").
 *
 * Only ever a path component — the real label is stored in Firestore alongside,
 * so nothing downstream has to reverse this. Arabic-Indic digits are folded the
 * same way the join keys are, so the same machine cannot land in two folders.
 */
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹";
export function machineSlug(machine: string): string {
  const latin = (machine ?? "").replace(/[٠-٩۰-۹]/g, (d) => String(AR_DIGITS.indexOf(d) % 10));
  const slug = latin
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")   // em-dash, spaces, anything else
    .replace(/^-+|-+$/g, "");
  return slug || "unknown";
}

/** `YYYY-MM-DD` — the factory day the photo belongs to. */
const isIsoDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

/**
 * Where the bytes go: hourly/<date>/<machine>/<timestamp>.jpg
 *
 * Date first so a day's sheets can be listed by prefix, and so a retention rule
 * ("delete before 2026-01") is a prefix operation. Several photos per day and
 * machine are expected and fine — a shift can fill more than one sheet.
 */
export function hourlyPhotoPath(date: string, machine: string, at: number): string {
  if (!isIsoDate(date)) throw new Error("bad_date");
  if (!Number.isFinite(at) || at <= 0) throw new Error("bad_timestamp");
  return `hourly/${date}/${machineSlug(machine)}/${Math.floor(at)}.jpg`;
}

/** Guard for anything arriving from a client before it is written down. */
export function isValidPhotoPath(p: string): boolean {
  return /^hourly\/\d{4}-\d{2}-\d{2}\/[a-z0-9-]+\/\d+\.jpg$/.test(p);
}

/**
 * The downscale target for an image of a given size — the long edge is capped,
 * the aspect ratio is kept, and an already-small image is left alone rather than
 * upscaled into a bigger file.
 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number = PHOTO_MAX_EDGE,
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width: Math.round(width), height: Math.round(height) };
  const scale = maxEdge / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
