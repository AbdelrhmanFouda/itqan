"use client";
import { useEffect, useState } from "react";
import { useLang } from "@/context/LangContext";
import { pd } from "@/lib/i18n.prod";
import { Stat, Spinner, EmptyState, inputCls } from "@/components/dashboard/ui";
import PaperImport from "@/components/dashboard/paper-import";

/** Mirrors lib/hourly.ts HourShape — see there for what each shape means. */
type HourShape = "empty" | "shiftTotal" | "flat" | "hourly";

type HourlyRow = {
  row: number; date: string; shift: string; machine: string; product: string;
  hours: (number | null)[];
  /** cells holding a number — NOT hours the machine ran. See lib/hourly.ts. */
  hourCellsFilled: number;
  shape: HourShape;
  shiftMinutes: number | null;
  systemTotal: number | null; actualTotal: number | null;
  expected: number | null; scrap: number | null;
  expectedSource: "sheet" | "registry" | "none";
  /** counter÷expected, actual÷expected, and the preferred one (actual first). */
  effSystem: number | null; effActual: number | null; efficiency: number | null;
};
type Payload = {
  date: string; dates: string[]; hourLabels: string[]; rows: HourlyRow[];
  totals: { system: number; actual: number; scrap: number; machines: number; withActual: number };
};

/**
 * What to say instead of "1 hrs" for a whole shift.
 *
 * The count of filled cells is a fact about CELLS. Printing it next to the word
 * "hours" turned it into a claim about TIME, and a shift-total row would have
 * read "1 hr" for twelve hours of work. Each shape gets its own words.
 */
function shapeLabel(r: HourlyRow, t: { hoursLogged: string; shiftTotal: string; flatRow: string }): string {
  if (r.shape === "shiftTotal") return t.shiftTotal;
  if (r.shape === "flat") return `${r.hourCellsFilled} ${t.hoursLogged} · ${t.flatRow}`;
  return `${r.hourCellsFilled} ${t.hoursLogged}`;
}

const effCls = (e: number | null) =>
  e === null ? "border-gray-200 bg-gray-50 text-gray-400"
  : e >= 0.9 ? "border-green-200 bg-green-50 text-green-700"
  : e >= 0.75 ? "border-amber-300 bg-amber-50 text-amber-700"
  : "border-red-200 bg-red-50 text-red-700";

export default function HourlyPage() {
  const { lang } = useLang();
  const p = pd[lang];
  const t = p.hourly;
  const isAr = lang === "ar";
  // The paper import is shown to EVERYONE who can reach this page — owner's
  // call, 2026-08-10: "the pages should be the same for all". It was briefly
  // owner-only; that made one page render two ways, which is the thing he did
  // not want. Both routes accept any approved role to match, and every write
  // still goes through the same two-press confirmation and the same
  // server-side re-validation, whoever is signed in.

  const [data, setData] = useState<Payload | null>(null);
  const [date, setDate] = useState<string>("");
  const [loading, setLoading] = useState(true);


  // `fresh` bypasses the 45s sheet-read cache. Used only after the paper
  // import writes: without it the crew can be shown their own rows missing,
  // because the cached copy predates the write.
  async function load(d?: string, fresh = false) {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (d) qs.set("date", d);
      if (fresh) qs.set("fresh", "1");
      const j = (await (await fetch(`/api/hourly${qs.toString() ? `?${qs}` : ""}`)).json()) as Payload;
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
          <PaperImport onWritten={(d) => load(d, true)} />
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
          <button onClick={() => load(date)} className="inline-flex items-center min-h-11 sm:min-h-0 text-xs text-blue-600 hover:underline">{t.refresh}</button>
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
                    {r.product}{r.shift ? ` · ${r.shift}` : ""} · {shapeLabel(r, t)}
                  </div>
                  {/* Hour strip — only where the hours mean something. A
                      shift-total row would otherwise draw one tall bar and 23
                      gaps, which reads as "this machine ran for one hour". */}
                  {r.shape === "shiftTotal" ? (
                    <div className="mt-2 rounded-md border border-dashed border-gray-300 bg-gray-50 px-3 py-2 text-xs text-gray-500">
                      {t.noHourDetail}
                    </div>
                  ) : (
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
                  )}
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
                      {/* A shift-total row has no hour-of-day information. Spanning
                          the 24 columns with one labelled cell says that plainly;
                          printing the number under 08:00 would claim the whole
                          shift happened in the first hour. */}
                      {r.shape === "shiftTotal" ? (
                        <td
                          colSpan={r.hours.length}
                          className="px-3 py-2 text-center text-gray-500 bg-gray-50/70 italic"
                          title={t.shiftTotalNote}
                        >
                          {t.shiftTotal} · {t.noHourDetail}
                        </td>
                      ) : (
                        r.hours.map((h, i) => (
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
                        ))
                      )}
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
