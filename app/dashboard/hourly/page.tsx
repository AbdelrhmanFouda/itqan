"use client";
import { useEffect, useState } from "react";
import { useLang } from "@/context/LangContext";
import { pd } from "@/lib/i18n.prod";
import { Stat, Spinner, EmptyState, inputCls } from "@/components/dashboard/ui";

type HourlyRow = {
  row: number; date: string; shift: string; machine: string; product: string;
  hours: (number | null)[]; hoursLogged: number;
  systemTotal: number | null; actualTotal: number | null;
  expected: number | null; efficiency: number | null; scrap: number | null;
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

export default function HourlyPage() {
  const { lang } = useLang();
  const p = pd[lang];
  const t = p.hourly;
  const isAr = lang === "ar";

  const [data, setData] = useState<Payload | null>(null);
  const [date, setDate] = useState<string>("");
  const [loading, setLoading] = useState(true);

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
                    <span className={`shrink-0 text-xs px-2.5 py-1 rounded-full border whitespace-nowrap ${effCls(r.efficiency)}`}>
                      {pct(r.efficiency)}
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
                        <span className={`inline-block text-xs px-2 py-0.5 rounded-full border ${effCls(r.efficiency)}`}>{pct(r.efficiency)}</span>
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
