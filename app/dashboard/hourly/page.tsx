"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLang } from "@/context/LangContext";
import { useAuth } from "@/context/AuthContext";
import { pd } from "@/lib/i18n.prod";
import { Stat, Spinner, EmptyState, inputCls } from "@/components/dashboard/ui";
import { authedFetch } from "@/lib/authed-fetch";
import { uploadHourlyPhoto, removeUploadedPhoto } from "@/lib/photo-upload";
import { PHOTO_ACCEPT } from "@/lib/photos";

type HourlyRow = {
  row: number; date: string; shift: string; machine: string; product: string;
  hours: (number | null)[]; hoursLogged: number;
  systemTotal: number | null; actualTotal: number | null;
  expected: number | null; scrap: number | null;
  /** counter÷expected, actual÷expected, and the preferred one (actual first). */
  effSystem: number | null; effActual: number | null; efficiency: number | null;
};
type Payload = {
  date: string; dates: string[]; hourLabels: string[]; rows: HourlyRow[];
  totals: { system: number; actual: number; scrap: number; machines: number; withActual: number };
};

const effCls = (e: number | null) =>
  e === null ? "border-gray-200 bg-gray-50 text-gray-400"
  : e >= 0.9 ? "border-green-200 bg-green-50 text-green-700"
  : e >= 0.75 ? "border-amber-300 bg-amber-50 text-amber-700"
  : "border-red-200 bg-red-50 text-red-700";

type Photo = {
  id: string; date: string; machine: string; path: string; url: string;
  sizeBytes: number; createdBy: string; createdAt?: number;
};
type MachineInfo = { label: string };

export default function HourlyPage() {
  const { lang } = useLang();
  const { user, loading: authLoading } = useAuth();
  const p = pd[lang];
  const t = p.hourly;
  const isAr = lang === "ar";

  const [data, setData] = useState<Payload | null>(null);
  const [date, setDate] = useState<string>("");
  const [loading, setLoading] = useState(true);

  /* ------------------------- log-sheet photos --------------------------- */
  // A photo of the PAPER sheet, so the record survives the gap between the crew
  // filling it in and somebody typing it into «تسجيل الإنتاج».
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [machines, setMachines] = useState<MachineInfo[]>([]);
  const [busyMachine, setBusyMachine] = useState<string | null>(null);
  const [photoErr, setPhotoErr] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const pendingMachine = useRef<string>("");

  const loadPhotos = useCallback(async (d: string) => {
    if (!d) return;
    try {
      const res = await authedFetch(`/api/hourly-photos?date=${d}`);
      if (res.ok) setPhotos((await res.json()).photos ?? []);
    } catch {
      /* the table is still useful without them */
    }
  }, []);

  useEffect(() => {
    fetch("/api/machines")
      .then((r) => r.json())
      .then((d) => setMachines(d.machines ?? []))
      .catch(() => setMachines([]));
  }, []);

  // Wait for the session: /api/hourly-photos is guarded, and authedFetch reads
  // auth.currentUser, which is null for the first moments after a page load.
  useEffect(() => {
    if (authLoading || !user || !date) return;
    loadPhotos(date);
  }, [authLoading, user, date, loadPhotos]);

  /** Tapping a machine opens the camera straight away — the machine is implied,
   *  so there is no picker step and nothing to type. */
  function capture(machine: string) {
    if (busyMachine) return;
    setPhotoErr(false);
    pendingMachine.current = machine;
    fileInput.current?.click();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same machine be photographed twice in a row
    const machine = pendingMachine.current;
    if (!file || !machine || !date) return;

    setBusyMachine(machine);
    setPhotoErr(false);
    let uploaded: { path: string; url: string; sizeBytes: number } | null = null;
    try {
      uploaded = await uploadHourlyPhoto(file, date, machine);
      const res = await authedFetch("/api/hourly-photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, machine, ...uploaded }),
      });
      if (!res.ok) throw new Error("meta_failed");
      await loadPhotos(date);
    } catch {
      setPhotoErr(true);
      // Don't leave bytes in the bucket that nothing points at.
      if (uploaded) await removeUploadedPhoto(uploaded.path);
    }
    setBusyMachine(null);
  }

  async function deletePhoto(ph: Photo) {
    if (!confirm(t.photoConfirmDelete)) return;
    try {
      const res = await authedFetch(`/api/hourly-photos?id=${ph.id}`, { method: "DELETE" });
      if (res.ok) {
        // The server cannot touch Storage (it is unauthenticated there); the
        // browser can, as the signed-in user.
        await removeUploadedPhoto(ph.path);
        await loadPhotos(date);
      }
    } catch {
      setPhotoErr(true);
    }
  }

  async function load(d?: string) {
    setLoading(true);
    try {
      const j = (await (await fetch(`/api/hourly${d ? `?date=${d}` : ""}`)).json()) as Payload;
      if (j && Array.isArray(j.rows)) { setData(j); setDate(j.date); }
    } catch { /* keep whatever we have */ }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);
  // Refresh the visible day every 60s — the floor updates this tab through the day.
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden && date) load(date); }, 60000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const fmt = (n: number | null) => (n === null ? "—" : n.toLocaleString(isAr ? "ar-EG" : "en-US"));
  const pct = (e: number | null) => (e === null ? "—" : `${Math.round(e * 100)}%`);
  // The definitive efficiency is الفعلي ÷ المتوقع (owner's rule). Until الفعلي is
  // counted, the counter-based number is shown as an approximation (≈).
  const effText = (r: HourlyRow) =>
    r.effActual !== null ? pct(r.effActual) : r.effSystem !== null ? `≈${pct(r.effSystem)}` : "—";

  return (
    <div className="max-w-6xl" dir={isAr ? "rtl" : "ltr"}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <h1 className="text-2xl font-bold text-gray-900">{t.title}</h1>
        <div className="flex items-center gap-2">
          <select
            className={`${inputCls} w-auto`}
            value={date}
            onChange={(e) => load(e.target.value)}
            aria-label={t.date}
          >
            {(data?.dates ?? (date ? [date] : [])).map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <button onClick={() => load(date)} className="text-xs text-blue-600 hover:underline">{t.refresh}</button>
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-5">{t.subtitle}</p>

      {data && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Stat label={t.system} value={fmt(data.totals.system)} />
          <Stat label={t.actual} value={data.totals.withActual > 0 ? fmt(data.totals.actual) : "—"} />
          <Stat
            label={t.scrap}
            value={data.totals.withActual > 0 ? fmt(data.totals.scrap) : "—"}
            tone={data.totals.withActual > 0 && data.totals.scrap > 0 ? "red" : undefined}
          />
          <Stat label={t.machines} value={data.totals.machines} />
        </div>
      )}

      {/* ---- Photos of the paper log sheet ----------------------------------
           Above the table on purpose: the whole point is to capture the sheet
           BEFORE anyone types it up, so a worker must meet this first. One tap
           per machine opens the camera; there is nothing to type. */}
      <section className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
          <h2 className="font-semibold text-gray-900">{t.photos}</h2>
          <span className="text-xs text-gray-500">{date}</span>
        </div>
        <p className="text-xs text-gray-500 mb-3">{t.photosHint}</p>

        <input
          ref={fileInput}
          type="file"
          accept={PHOTO_ACCEPT}
          capture="environment"
          onChange={onFile}
          className="hidden"
        />

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {machines.map((m) => {
            const busy = busyMachine === m.label;
            const count = photos.filter((ph) => ph.machine === m.label).length;
            return (
              <button
                key={m.label}
                onClick={() => capture(m.label)}
                disabled={!!busyMachine || !date}
                className="min-h-[56px] rounded-xl border-2 border-gray-300 bg-white px-3 py-2 text-base font-semibold text-gray-900 transition active:scale-[0.98] hover:border-blue-400 disabled:opacity-50 disabled:active:scale-100"
              >
                <span className="block truncate">{m.label}</span>
                <span className="block text-xs font-normal text-gray-500">
                  {busy ? t.photoUploading : count > 0 ? `📷 ${count}` : "＋"}
                </span>
              </button>
            );
          })}
        </div>

        {photoErr && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {t.photoFailed}
          </p>
        )}

        {photos.length === 0 ? (
          <p className="mt-3 text-sm text-gray-400">{t.photosNone}</p>
        ) : (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {photos.map((ph) => (
              <figure key={ph.id} className="rounded-lg border border-gray-200 overflow-hidden">
                <a href={ph.url} target="_blank" rel="noopener noreferrer" title={t.photoOpen}>
                  {/* Plain <img>: these are user photos on a Firebase Storage
                      domain, not build-time assets, so next/image would need a
                      remote-pattern allowlist for no benefit here. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ph.url} alt={`${ph.machine} — ${ph.date}`} className="h-28 w-full object-cover" />
                </a>
                <figcaption className="px-2 py-1.5">
                  <span className="block truncate text-xs font-medium text-gray-800">{ph.machine}</span>
                  <button
                    onClick={() => deletePhoto(ph)}
                    className="mt-0.5 text-xs text-red-600 hover:underline"
                  >
                    {t.photoDelete}
                  </button>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>

      {loading && data === null ? (
        <Spinner text={p.common.loading} />
      ) : !data || data.rows.length === 0 ? (
        <EmptyState text={t.empty} />
      ) : (
        <>
          {/* Phone: one card per machine with an hour bar-strip */}
          <div className="lg:hidden space-y-2">
            {data.rows.map((r) => {
              const max = Math.max(1, ...r.hours.map((h) => h ?? 0));
              return (
                <div key={r.row} className="bg-white border border-gray-200 rounded-xl px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-gray-900 leading-snug">{r.machine}</span>
                    <span
                      title={r.effActual !== null ? `${t.actual} ÷ ${t.expected}` : `${t.system} ÷ ${t.expected}`}
                      className={`shrink-0 text-xs px-2.5 py-1 rounded-full border whitespace-nowrap ${effCls(r.efficiency)}`}
                    >
                      {effText(r)}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {r.product}{r.shift ? ` · ${r.shift}` : ""} · {r.hoursLogged} {t.hoursLogged}
                  </div>
                  {/* hour strip: 24 slots, height ∝ pieces */}
                  <div className="flex items-end gap-[2px] h-10 mt-2" dir="ltr">
                    {r.hours.map((h, i) => (
                      <div
                        key={i}
                        title={`${data.hourLabels[i]}: ${h ?? "—"}`}
                        className={`flex-1 rounded-sm ${h === null ? "bg-gray-100" : h === 0 ? "bg-gray-300" : "bg-blue-500"}`}
                        style={{ height: h ? `${Math.max(12, (h / max) * 100)}%` : "6px" }}
                      />
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm mt-2">
                    <span className="text-gray-700 font-medium">{fmt(r.systemTotal)}</span>
                    {r.actualTotal !== null ? (
                      <>
                        <span className="text-green-600">{t.actual}: {fmt(r.actualTotal)}</span>
                        {r.scrap !== null && r.scrap > 0 && <span className="text-red-500">{fmt(r.scrap)} ✗</span>}
                      </>
                    ) : (
                      <span className="text-gray-400 text-xs">{t.noActual}</span>
                    )}
                    {r.expected !== null && <span className="text-gray-400 text-xs">{t.expected}: {fmt(r.expected)}</span>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop: the full 24-hour grid */}
          <div className="hidden lg:block bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-xs" dir={isAr ? "rtl" : "ltr"}>
              <thead>
                <tr className="text-gray-500 border-b border-gray-100 uppercase tracking-wide">
                  <th className="text-start font-medium px-3 py-2.5 whitespace-nowrap">{t.machine}</th>
                  <th className="text-start font-medium px-3 py-2.5">{t.product}</th>
                  {data.hourLabels.map((h) => (
                    <th key={h} className="font-medium px-1 py-2.5 text-center whitespace-nowrap" dir="ltr">{h.slice(0, 2)}</th>
                  ))}
                  <th className="text-start font-medium px-3 py-2.5 whitespace-nowrap">{t.system}</th>
                  <th className="text-start font-medium px-3 py-2.5 whitespace-nowrap">{t.actual}</th>
                  <th className="text-start font-medium px-3 py-2.5">✗</th>
                  <th className="text-start font-medium px-3 py-2.5 whitespace-nowrap">{t.efficiency}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.rows.map((r) => {
                  const max = Math.max(1, ...r.hours.map((h) => h ?? 0));
                  return (
                    <tr key={r.row} className="hover:bg-gray-50/60">
                      <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">{r.machine}</td>
                      <td className="px-3 py-2 text-gray-600 max-w-[10rem] truncate">{r.product}</td>
                      {r.hours.map((h, i) => (
                        <td
                          key={i}
                          dir="ltr"
                          className={`px-1 py-2 text-center tabular-nums ${
                            h === null ? "text-gray-300"
                            : h === 0 ? "text-gray-400 bg-gray-50"
                            : h >= max * 0.75 ? "text-blue-900 bg-blue-100 font-medium"
                            : "text-blue-800 bg-blue-50"
                          }`}
                        >
                          {h === null ? "·" : h}
                        </td>
                      ))}
                      <td className="px-3 py-2 font-medium text-gray-900">{fmt(r.systemTotal)}</td>
                      <td className="px-3 py-2 text-green-700">{fmt(r.actualTotal)}</td>
                      <td className="px-3 py-2 text-red-500">{r.scrap !== null && r.scrap > 0 ? fmt(r.scrap) : "—"}</td>
                      <td className="px-3 py-2">
                        <span
                          title={r.effActual !== null ? `${t.actual} ÷ ${t.expected}` : `${t.system} ÷ ${t.expected}`}
                          className={`inline-block text-xs px-2 py-0.5 rounded-full border ${effCls(r.efficiency)}`}
                        >
                          {effText(r)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
