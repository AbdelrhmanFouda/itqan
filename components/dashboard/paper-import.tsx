"use client";
import { useMemo, useRef, useState } from "react";
import { useLang } from "@/context/LangContext";
import { pd } from "@/lib/i18n.prod";
import { authedFetch } from "@/lib/authed-fetch";
import { Btn, Spinner, inputCls } from "@/components/dashboard/ui";
import { scaleHours, type ScaleMode, type Shift } from "@/lib/sheet-import";

/**
 * The editable preview between a photographed paper sheet and «تسجيل الإنتاج».
 *
 * Why it is editable at all: a misread handwritten digit is not a rare failure,
 * it is the expected one, and «تسجيل الإنتاج» is the crew's own log. Every cell
 * the import would write is a field here — hours, the counted total, the
 * machine, the product and the shots→pieces multiplier — and none of it reaches
 * the sheet until the owner presses write twice.
 *
 * What the browser sends on confirm is exactly the numbers shown on screen. The
 * server then re-derives every row number, name and permission from a fresh
 * read before writing — see lib/hourly-import.ts. Nothing here is trusted.
 */

type DraftRow = {
  id: string;
  index: number | null;
  machinePaper: string; productPaper: string;
  hoursPaper: (number | null)[]; actualPaper: number | null; note: string | null;
  machine: string; product: string;
  machineResolved: boolean; productResolved: boolean;
  cavities: number;
  targetRow: number | null;
};

type Draft = {
  ok: true;
  date: string; datePaper: string | null; dateForNewRow: string;
  shift: Shift | null; shiftHeading: string; shiftLabelForNewRow: string;
  rows: DraftRow[]; machineOptions: string[]; productOptions: string[];
  freeRows: number; model: string;
};

type Outcome = {
  index: number; machine: string; product: string;
  row: number | null; action: "update" | "create"; ok: boolean; reason?: string;
};

/** Editable state per row — the paper reading is kept alongside, never overwritten. */
type EditRow = DraftRow & {
  include: boolean;
  multiplier: number;
  hours: (number | null)[];
  actualTotal: number | null;
};

/**
 * Decode a camera file to something canvas can draw.
 *
 * `createImageBitmap` is tried first and handles JPEG/PNG/WebP everywhere. It
 * does NOT decode HEIC in most browsers — and HEIC is what an iPhone shoots by
 * default, so without the second path a phone photo cannot be read at all.
 * Rendering the file through an <img> lets Safari hand the job to the OS
 * decoder, which does know HEIC.
 *
 * `imageOrientation: "from-image"` is not decoration. Phone photos record their
 * rotation in EXIF rather than in the pixels, and a page fed to the model
 * sideways does not degrade gracefully — measured 2026-08-10, it collapsed into
 * twenty hallucinated rows. The <img> path applies EXIF on its own.
 */
async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode_failed")); };
      img.src = url;
    });
  }
}

/**
 * Shrink a phone photo before it leaves the device, always emitting JPEG.
 *
 * There is deliberately NO raw-original fallback any more. The old one looked
 * harmless and was the likely cause of the phone-only failure: when the decode
 * failed it shipped the untouched camera file — several megabytes of HEIC — at
 * which point either the platform's request limit or the model rejected it, and
 * the floor just saw "the reader could not be reached". Failing here with a
 * clear message beats uploading something that cannot work.
 */
const MAX_BASE64_CHARS = 3_500_000; // comfortably inside the platform body cap

/**
 * Re-encode the decoded image to JPEG, rotated by `deg`, small enough to send.
 *
 * Rotation is a first-class parameter because a sideways page is not a
 * degraded read, it is a failed one: measured 2026-08-10, the same page that
 * scores 6/6 upright produced twenty hallucinated rows when fed sideways. The
 * page is landscape and phones are held portrait, so this is the normal case,
 * not an edge case.
 */
/** A crop in normalized 0..1 coordinates of the source image. */
export type Crop = { x: number; y: number; w: number; h: number };
const FULL: Crop = { x: 0, y: 0, w: 1, h: 1 };

function encodeJpeg(
  src: ImageBitmap | HTMLImageElement, w0: number, h0: number, deg: number, crop: Crop = FULL,
): string | null {
  const sx = Math.round(crop.x * w0), sy = Math.round(crop.y * h0);
  const sw = Math.max(1, Math.round(crop.w * w0)), sh = Math.max(1, Math.round(crop.h * h0));
  const attempts: [number, number][] = [[1800, 0.85], [1800, 0.7], [1400, 0.7], [1100, 0.6]];
  for (const [maxEdge, quality] of attempts) {
    const scale = Math.min(1, maxEdge / Math.max(sw, sh));
    const w = Math.round(sw * scale);
    const h = Math.round(sh * scale);
    const canvas = document.createElement("canvas");
    const quarter = deg % 180 !== 0;
    canvas.width = quarter ? h : w;
    canvas.height = quarter ? w : h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((deg * Math.PI) / 180);
    ctx.drawImage(src as CanvasImageSource, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
    const url = canvas.toDataURL("image/jpeg", quality);
    const comma = url.indexOf(",");
    if (comma < 0) continue;
    const base64 = url.slice(comma + 1);
    if (base64.length <= MAX_BASE64_CHARS) return base64;
  }
  return null;
}

/** A screen-sized preview of the decoded image, so the crop step shows exactly
 *  what will be sent — including HEIC, which an <img> cannot always render. */
function previewUrl(src: ImageBitmap | HTMLImageElement, w0: number, h0: number): string {
  const scale = Math.min(1, 900 / Math.max(w0, h0));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w0 * scale);
  canvas.height = Math.round(h0 * scale);
  canvas.getContext("2d")?.drawImage(src as CanvasImageSource, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.8);
}

const numOrNull = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

export default function PaperImport({ onWritten }: { onWritten: (date: string) => void }) {
  const { lang } = useLang();
  const t = pd[lang].hourly.import;
  const isAr = lang === "ar";

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"reading" | "writing" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [rows, setRows] = useState<EditRow[]>([]);
  const [shift, setShift] = useState<Shift | "">("");
  const [mode, setMode] = useState<ScaleMode>("faithful");
  const [armed, setArmed] = useState(false);
  /** Set when the photo only read after being turned — worth telling the user,
   *  so next time they hold the phone the other way and save two model calls. */
  const [rotatedBy, setRotatedBy] = useState<number | null>(null);
  const [done, setDone] = useState<{ written: number } | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  /** The chosen photo, held decoded so cropping never re-decodes it (HEIC is slow). */
  const srcRef = useRef<{ src: ImageBitmap | HTMLImageElement; w0: number; h0: number } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [crop, setCrop] = useState<Crop | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const imgBoxRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const msg = (code: string | undefined) =>
    (code && (t.errors as Record<string, string>)[code]) || code || t.errors.server_error;

  function seed(d: Draft, m: ScaleMode) {
    setRows(
      d.rows.map((r) => {
        const mult = r.cavities > 0 ? r.cavities : 1;
        return {
          ...r,
          include: true,
          multiplier: mult,
          hours: scaleHours(r.hoursPaper, mult, m),
          actualTotal: r.actualPaper === null ? null : Math.round(r.actualPaper * mult),
        };
      }),
    );
  }

  function reset() {
    setDraft(null); setRows([]); setShift(""); setError(null);
    setDone(null); setOutcomes([]); setArmed(false);
    setPreview(null); setCrop(null); setRotatedBy(null);
    const held = srcRef.current;
    if (held && !(held.src instanceof HTMLImageElement)) held.src.close?.();
    srcRef.current = null;
    if (fileRef.current) fileRef.current.value = "";
  }

  /* --------- drawing the crop box: pointer coords → normalized 0..1 -------- */
  const pointToNorm = (e: React.PointerEvent) => {
    const r = imgBoxRef.current?.getBoundingClientRect();
    if (!r) return null;
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };
  const onDragStart = (e: React.PointerEvent) => {
    const p = pointToNorm(e);
    if (!p) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = p;
    setCrop({ x: p.x, y: p.y, w: 0, h: 0 });
  };
  const onDragMove = (e: React.PointerEvent) => {
    const s = dragRef.current;
    if (!s) return;
    const p = pointToNorm(e);
    if (!p) return;
    setCrop({
      x: Math.min(s.x, p.x), y: Math.min(s.y, p.y),
      w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y),
    });
  };
  const onDragEnd = () => {
    dragRef.current = null;
    // A tap rather than a drag should not leave a useless sliver behind.
    setCrop((c) => (c && (c.w < 0.05 || c.h < 0.05) ? null : c));
  };

  /** Step 1 — decode and show the photo so a crop can be drawn on it. No model
   *  call happens here. Cropping the background away is the single largest
   *  accuracy lever measured (2/6 → 6/6 on the same photo), and only the person
   *  holding the page knows where the table is. */
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null); setDone(null); setOutcomes([]); setArmed(false);
    setRotatedBy(null); setDraft(null); setCrop(null);
    try {
      const src = await decodeImage(file);
      const w0 = src instanceof HTMLImageElement ? src.naturalWidth : src.width;
      const h0 = src instanceof HTMLImageElement ? src.naturalHeight : src.height;
      if (!w0 || !h0) { setError(msg("decode_failed")); return; }
      srcRef.current = { src, w0, h0 };
      setPreview(previewUrl(src, w0, h0));
    } catch {
      setError(msg("decode_failed"));
    }
  }

  /** Step 2 — send it, cropped if a box was drawn. */
  async function read(cropped: Crop | null) {
    const held = srcRef.current;
    if (!held) return;
    const { src, w0, h0 } = held;
    setError(null); setBusy("reading"); setRotatedBy(null);
    try {
      // The sheet is landscape. A portrait photo is therefore probably a
      // sideways page, so try the rotations first — it saves a wasted call in
      // the common case rather than only rescuing the uncommon one.
      const region = cropped ?? FULL;
      const rw = region.w * w0, rh = region.h * h0;
      const order = rh > rw ? [90, 270, 0] : [0, 90, 270];

      let lastFail: { reason?: string; detail?: string } | null = null;
      for (const deg of order) {
        const base64 = encodeJpeg(src, w0, h0, deg, region);
        if (!base64) { lastFail = { reason: "too_large" }; break; }
        const res = await authedFetch("/api/hourly/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: base64, mimeType: "image/jpeg" }),
        });
        const j = await res.json();
        if (j?.ok) {
          setDraft(j as Draft); setShift((j as Draft).shift ?? ""); seed(j as Draft, mode);
          setRotatedBy(deg === 0 ? null : deg);
          lastFail = null;
          break;
        }
        lastFail = j ?? {};
        // Only an unreadable page is worth another orientation. A missing key,
        // a rate limit or a rejected payload will fail identically whichever
        // way up the image is, and retrying them just burns quota.
        if (j?.reason !== "unreadable") break;
      }

      if (lastFail) {
        // The technical detail (e.g. "gemini_400") rides along in small print.
        // It is not sensitive, and it is the difference between "it broke" and
        // a failure someone can actually diagnose from a photo of the screen —
        // which is how the phone-only one was reported.
        setError(msg(lastFail.reason) + (lastFail.detail ? ` (${lastFail.detail})` : ""));
        setDraft(null);
      }
    } catch {
      setError(t.errors.server_error);
    }
    setBusy(null);
  }

  function setRow(id: string, patch: Partial<EditRow>) {
    setArmed(false);
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  /** Changing the multiplier or the hour shape recomputes from the PAPER
   *  reading, not from the current cells — otherwise the scaling compounds. */
  function rescaleRow(id: string, multiplier: number) {
    setArmed(false);
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r, multiplier,
              hours: scaleHours(r.hoursPaper, multiplier, mode),
              actualTotal: r.actualPaper === null ? null : Math.round(r.actualPaper * multiplier),
            }
          : r,
      ),
    );
  }

  function changeMode(m: ScaleMode) {
    setMode(m); setArmed(false);
    setRows((prev) => prev.map((r) => ({ ...r, hours: scaleHours(r.hoursPaper, r.multiplier, m) })));
  }

  const included = rows.filter((r) => r.include);
  const machineOk = (r: EditRow) => draft?.machineOptions.includes(r.machine) ?? false;
  const productOk = (r: EditRow) => draft?.productOptions.includes(r.product) ?? false;
  const blockedRows = included.filter((r) => !machineOk(r) || !productOk(r));

  const blocker = useMemo(() => {
    if (!draft) return null;
    if (!shift) return t.noShift;
    if (included.length === 0) return t.noneIncluded;
    if (blockedRows.length > 0) return t.blocked;
    return null;
  }, [draft, shift, included.length, blockedRows.length, t]);

  async function write() {
    if (!draft || !shift || blocker) return;
    setBusy("writing"); setError(null); setOutcomes([]);
    try {
      const res = await authedFetch("/api/hourly/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: draft.date,
          shift,
          rows: included.map((r) => ({
            targetRow: r.targetRow,
            machine: r.machine,
            product: r.product,
            hours: r.hours,
            actualTotal: r.actualTotal,
          })),
        }),
      });
      const j = await res.json();
      if (j?.ok) {
        setDone({ written: j.written ?? included.length });
        setDraft(null); setRows([]); setArmed(false);
        onWritten(draft.date);
      } else {
        setError(msg(j?.reason === "validation_failed" ? undefined : j?.reason));
        setOutcomes(Array.isArray(j?.outcomes) ? j.outcomes.filter((o: Outcome) => !o.ok) : []);
        setArmed(false);
      }
    } catch {
      setError(t.errors.server_error);
    }
    setBusy(null);
  }

  if (!open) {
    return (
      <Btn variant="outline" onClick={() => setOpen(true)}>
        {t.open}
      </Btn>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 p-0 sm:p-4 sm:pt-10 overflow-auto"
      onClick={() => { if (!busy) { setOpen(false); reset(); } }}
    >
      <div
        dir={isAr ? "rtl" : "ltr"}
        className="bg-white sm:rounded-2xl w-full sm:max-w-5xl mx-auto shadow-2xl min-h-full sm:min-h-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 sm:px-5 py-4 border-b border-gray-100 sticky top-0 bg-white sm:rounded-t-2xl z-10">
          <h3 className="font-semibold text-gray-900">{t.title}</h3>
          <button
            onClick={() => { if (!busy) { setOpen(false); reset(); } }}
            className="text-sm text-gray-500 hover:text-gray-800"
          >
            {t.close}
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          <p className="text-sm text-gray-500">{t.intro}</p>
          {/* Framing is the single biggest lever on accuracy — measured, not
              guessed: the same page scored 2/5 whole-frame and 4/5 once the
              background was cropped away, with no extra pixels involved. */}
          {!draft && <p className="text-xs text-gray-400">{t.tips}</p>}

          <div className="flex flex-wrap items-center gap-3">
            {/* NO `capture` attribute. With it, a phone opens the camera and
                never offers the photo library — so a page already photographed
                (or one taken carefully and transferred) could not be chosen at
                all. Plain accept="image/*" gives the OS sheet: take a photo, or
                pick an existing one. */}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={onFile}
              disabled={busy !== null}
              className="text-sm file:me-3 file:rounded-lg file:border-0 file:bg-blue-600 file:px-4 file:py-3 file:text-sm file:font-medium file:text-white hover:file:bg-blue-500 disabled:opacity-50"
            />
            {draft && (
              <span className="text-xs text-gray-500">
                {draft.rows.length} {t.rowsRead} · {draft.freeRows} {t.freeRows} · {t.model}: {draft.model}
              </span>
            )}
            {rotatedBy !== null && (
              <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1">
                {t.rotated}
              </span>
            )}
          </div>

          {/* ---- crop step: drag a box round the table, then read ---- */}
          {preview && !draft && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">{t.cropHint}</p>
              <div
                ref={imgBoxRef}
                onPointerDown={onDragStart}
                onPointerMove={onDragMove}
                onPointerUp={onDragEnd}
                onPointerCancel={onDragEnd}
                className="relative inline-block max-w-full touch-none select-none cursor-crosshair rounded-lg overflow-hidden border border-gray-200"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="" className="block max-w-full max-h-[50vh] w-auto pointer-events-none" />
                {crop && crop.w > 0 && crop.h > 0 && (
                  // A single bordered box. `box-shadow: 0 0 0 9999px` dims
                  // everything OUTSIDE it in one declaration — no second layer
                  // to keep in sync and nothing to punch back through.
                  <div
                    className="absolute border-2 border-blue-400 pointer-events-none"
                    style={{
                      left: `${crop.x * 100}%`, top: `${crop.y * 100}%`,
                      width: `${crop.w * 100}%`, height: `${crop.h * 100}%`,
                      boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)",
                    }}
                  />
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Btn onClick={() => read(crop)} disabled={busy !== null}>
                  {crop ? t.readCrop : t.readWhole}
                </Btn>
                {crop && (
                  <Btn variant="outline" onClick={() => read(null)} disabled={busy !== null}>
                    {t.readWhole}
                  </Btn>
                )}
                {crop && <Btn variant="ghost" onClick={() => setCrop(null)}>{t.clearCrop}</Btn>}
              </div>
            </div>
          )}

          {busy === "reading" && <Spinner text={t.reading} />}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {outcomes.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 space-y-1">
              <div className="font-medium">{t.failed}</div>
              {outcomes.map((o) => (
                <div key={o.index}>
                  {o.machine || "—"} · {o.product || "—"} — {msg(o.reason?.split(":")[0])}
                </div>
              ))}
            </div>
          )}

          {done && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              {t.wrote} {done.written} {t.rowsWritten}
            </div>
          )}

          {draft && (
            <>
              {/* ---------- page-level facts: date, shift, hour shape ---------- */}
              <div className="rounded-xl border border-gray-200 p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                  <span className="text-gray-500">
                    {t.date}: <span className="text-gray-900 font-medium" dir="ltr">{draft.date}</span>
                    {draft.datePaper && draft.datePaper !== draft.date && (
                      <span className="text-gray-400"> ({t.paperReading} {draft.datePaper})</span>
                    )}
                  </span>
                  {draft.shiftHeading && (
                    <span className="text-gray-400 text-xs">{t.heading}: {draft.shiftHeading}</span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-gray-500 me-1">{t.shift}:</span>
                  {(["morning", "evening"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => { setShift(s); setArmed(false); }}
                      className={`text-sm px-3 py-1.5 rounded-lg border ${
                        shift === s
                          ? "border-blue-500 bg-blue-50 text-blue-800 font-medium"
                          : "border-gray-300 text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      {s === "morning" ? t.morning : t.evening}
                    </button>
                  ))}
                </div>
                {!draft.shift && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    {t.shiftUnknown}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-gray-500 me-1">{t.mode}:</span>
                  {(["faithful", "flatten"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => changeMode(m)}
                      className={`text-sm px-3 py-1.5 rounded-lg border ${
                        mode === m
                          ? "border-blue-500 bg-blue-50 text-blue-800 font-medium"
                          : "border-gray-300 text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      {m === "faithful" ? t.faithful : t.flatten}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-400">{t.modeHint}</p>
                <p className="text-xs text-amber-700">{t.cavitiesHint}</p>
              </div>

              {/* ------------------------- the rows ------------------------- */}
              <div className="space-y-3">
                {rows.map((r) => {
                  const bad = r.include && (!machineOk(r) || !productOk(r));
                  return (
                    <div
                      key={r.id}
                      className={`rounded-xl border p-3 sm:p-4 space-y-3 ${
                        !r.include ? "border-gray-200 bg-gray-50 opacity-60"
                        : bad ? "border-red-300 bg-red-50/40"
                        : "border-gray-200"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label className="flex items-center gap-2 text-sm text-gray-600">
                          <input
                            type="checkbox"
                            checked={r.include}
                            onChange={(e) => setRow(r.id, { include: e.target.checked })}
                            className="w-4 h-4"
                          />
                          {r.include ? t.include : t.skipped}
                          {/* The paper's own «#». A row that keeps its machine and
                              product but takes the line below's numbers is the
                              observed failure on a real photo, and the printed
                              number is the only way to see it. */}
                          {r.index !== null && (
                            <span className="text-xs text-gray-400" dir="ltr">{t.paperRow} {r.index}</span>
                          )}
                        </label>
                        <span
                          className={`text-xs px-2.5 py-1 rounded-full border ${
                            r.targetRow === null
                              ? "border-blue-200 bg-blue-50 text-blue-700"
                              : "border-gray-200 bg-gray-50 text-gray-600"
                          }`}
                        >
                          {r.targetRow === null ? t.targetNew : `${t.targetExisting} ${r.targetRow}`}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">{t.machine}</label>
                          <select
                            className={inputCls}
                            value={machineOk(r) ? r.machine : ""}
                            onChange={(e) => setRow(r.id, { machine: e.target.value })}
                          >
                            <option value="">{t.pickOne}</option>
                            {draft.machineOptions.map((m) => (
                              <option key={m} value={m}>{m}</option>
                            ))}
                          </select>
                          <p className="text-xs text-gray-400 mt-1">
                            {t.paperReading}: <span dir="ltr">{r.machinePaper || "—"}</span>
                            {!r.machineResolved && (
                              <span className="text-red-600"> · {t.unresolvedMachine}</span>
                            )}
                          </p>
                        </div>

                        <div>
                          <label className="block text-xs text-gray-500 mb-1">{t.product}</label>
                          <select
                            className={inputCls}
                            value={productOk(r) ? r.product : ""}
                            onChange={(e) => {
                              setRow(r.id, { product: e.target.value });
                            }}
                          >
                            <option value="">{t.pickOne}</option>
                            {draft.productOptions.map((p) => (
                              <option key={p} value={p}>{p.trim()}</option>
                            ))}
                          </select>
                          <p className="text-xs text-gray-400 mt-1">
                            {t.paperReading}: {r.productPaper || "—"}
                            {!r.productResolved && (
                              <span className="text-red-600"> · {t.unresolvedProduct}</span>
                            )}
                          </p>
                        </div>

                        <div>
                          <label className="block text-xs text-gray-500 mb-1">{t.cavities}</label>
                          <input
                            type="number"
                            min={1}
                            inputMode="numeric"
                            className={inputCls}
                            value={r.multiplier}
                            onChange={(e) => rescaleRow(r.id, Math.max(1, Number(e.target.value) || 1))}
                          />
                          {r.cavities === 0 && (
                            <p className="text-xs text-amber-700 mt-1">{t.cavitiesMissing}</p>
                          )}
                        </div>
                      </div>

                      {/* twelve editable hour cells — 4 across on a phone, 12 on desktop */}
                      <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-12 gap-1.5" dir="ltr">
                        {r.hours.map((h, i) => (
                          <input
                            key={i}
                            type="number"
                            min={0}
                            inputMode="numeric"
                            aria-label={`${r.machine} ${i + 1}`}
                            className="w-full border border-gray-300 rounded-md px-1 py-1.5 text-center text-sm tabular-nums text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                            value={h === null ? "" : h}
                            onChange={(e) => {
                              const next = [...r.hours];
                              next[i] = numOrNull(e.target.value);
                              setRow(r.id, { hours: next });
                            }}
                          />
                        ))}
                      </div>
                      <p className="text-xs text-gray-400" dir="ltr">
                        {t.paperReading}:{" "}
                        {r.hoursPaper.map((h) => (h === null ? "·" : h)).join(" ")}
                      </p>

                      <div className="flex flex-wrap items-end gap-3">
                        <div className="w-40">
                          <label className="block text-xs text-gray-500 mb-1">{t.actual}</label>
                          <input
                            type="number"
                            min={0}
                            inputMode="numeric"
                            className={inputCls}
                            value={r.actualTotal === null ? "" : r.actualTotal}
                            onChange={(e) => setRow(r.id, { actualTotal: numOrNull(e.target.value) })}
                          />
                        </div>
                        <p className="text-xs text-gray-400 pb-2">
                          {t.paperReading}: {r.actualPaper ?? "—"}
                        </p>
                        {r.note && <p className="text-xs text-amber-700 pb-2">{r.note}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* --------------------- confirm before write --------------------- */}
              <div className="flex flex-wrap items-center gap-3 pt-1 pb-2 sticky bottom-0 bg-white border-t border-gray-100 -mx-4 sm:-mx-5 px-4 sm:px-5 py-3">
                {blocker ? (
                  <span className="text-sm text-red-600">{blocker}</span>
                ) : !armed ? (
                  <Btn onClick={() => setArmed(true)} disabled={busy !== null}>
                    {t.confirm}
                  </Btn>
                ) : (
                  <Btn onClick={write} disabled={busy !== null}>
                    {busy === "writing" ? t.writing : t.confirmAgain}
                  </Btn>
                )}
                {armed && !busy && (
                  <Btn variant="ghost" onClick={() => setArmed(false)}>{t.cancel}</Btn>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
