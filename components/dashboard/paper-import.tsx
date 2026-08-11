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

async function compress(
  file: File,
): Promise<{ base64: string; mimeType: string } | { error: "decode_failed" | "too_large" }> {
  let src: ImageBitmap | HTMLImageElement;
  try {
    src = await decodeImage(file);
  } catch {
    return { error: "decode_failed" };
  }

  const w0 = src instanceof HTMLImageElement ? src.naturalWidth : src.width;
  const h0 = src instanceof HTMLImageElement ? src.naturalHeight : src.height;
  if (!w0 || !h0) return { error: "decode_failed" };

  // Step down until the payload fits. 1800px keeps the grid legible — the read
  // that scored 6/6 was 1600px on the long edge — so quality is traded first.
  const attempts: [number, number][] = [[1800, 0.85], [1800, 0.7], [1400, 0.7], [1100, 0.6]];
  for (const [maxEdge, quality] of attempts) {
    const scale = Math.min(1, maxEdge / Math.max(w0, h0));
    const w = Math.round(w0 * scale);
    const h = Math.round(h0 * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { error: "decode_failed" };
    ctx.drawImage(src as CanvasImageSource, 0, 0, w, h);
    const url = canvas.toDataURL("image/jpeg", quality);
    const comma = url.indexOf(",");
    if (comma < 0) continue;
    const base64 = url.slice(comma + 1);
    if (base64.length <= MAX_BASE64_CHARS) {
      if (!(src instanceof HTMLImageElement)) src.close?.();
      return { base64, mimeType: "image/jpeg" };
    }
  }
  if (!(src instanceof HTMLImageElement)) src.close?.();
  return { error: "too_large" };
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
  const [done, setDone] = useState<{ written: number } | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
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
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null); setDone(null); setOutcomes([]); setArmed(false); setBusy("reading");
    try {
      const shrunk = await compress(file);
      if ("error" in shrunk) { setError(msg(shrunk.error)); setBusy(null); return; }
      const { base64, mimeType } = shrunk;
      const res = await authedFetch("/api/hourly/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mimeType }),
      });
      const j = await res.json();
      if (!j?.ok) {
        // The technical detail (e.g. "gemini_400") rides along in small print.
        // It is not sensitive, and it is the difference between "it broke" and
        // a phone-only failure someone can actually diagnose from a photo of
        // the screen — which is how this one was reported.
        setError(msg(j?.reason) + (j?.detail ? ` (${j.detail})` : ""));
        setDraft(null);
      } else { setDraft(j as Draft); setShift((j as Draft).shift ?? ""); seed(j as Draft, mode); }
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
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onFile}
              disabled={busy !== null}
              className="text-sm file:me-3 file:rounded-lg file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-blue-500 disabled:opacity-50"
            />
            {draft && (
              <span className="text-xs text-gray-500">
                {draft.rows.length} {t.rowsRead} · {draft.freeRows} {t.freeRows} · {t.model}: {draft.model}
              </span>
            )}
          </div>

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
