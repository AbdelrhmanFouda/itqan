"use client";
import { usePageTitle } from "@/components/dashboard/use-page-title";
import { useState, useCallback, useMemo, useRef } from "react";
import { useLang } from "@/context/LangContext";
import { ad } from "@/lib/i18n.auth";
import { pd } from "@/lib/i18n.prod";
import { SHIFTS, downtimeReasonLabel, localize } from "@/lib/prod-meta";
import { Stat, inputCls, Btn, Spinner, EmptyState, LoadError } from "@/components/dashboard/ui";
import { Plus } from "lucide-react";
import { authedFetch } from "@/lib/authed-fetch";
import { timedJson } from "@/components/dashboard/last-seen";
import { useRemembered } from "@/components/dashboard/use-remembered";
import { moldsByName, moldNumberOf, productOf, type MachineRow, type MoldRow, type RunRow } from "@/lib/run-row";
import { LogRunModal } from "@/components/dashboard/log-run-modal";
import { fmtNum } from "@/lib/format";
import { factoryDay } from "@/lib/dates";


/** The last «الإنتاج» answer this device saw — painted at once on the next open. */
const LAST_KEY = "itqan.quality.last";
export default function QualityPage() {
  const { lang } = useLang();
  const a = ad[lang];
  const p = pd[lang];
  const isAr = lang === "ar";
  usePageTitle(a.quality.title);
  const today = factoryDay();

  const [date, setDate] = useState(today);
  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [molds, setMolds] = useState<MoldRow[]>([]);
  const [open, setOpen] = useState(false);


  // The registry and the mould numbers only feed the log form, so they are
  // started AFTER the day's entries have answered, and only once: the bridge
  // serves one tab at a time, and starting them alongside queued two cold tab
  // reads in front of the read this page exists to show (see the production
  // page). Non-blocking — a failure leaves a dropdown empty, not the page.
  const listsStarted = useRef(false);
  const loadLists = useCallback(() => {
    if (listsStarted.current) return;
    listsStarted.current = true;
    fetch("/api/machines").then((x) => x.json()).then((m) => setMachines(m.machines ?? [])).catch(() => {});
    // Master (guarded) rather than the open view — see the production page.
    authedFetch("/api/molds").then((x) => x.json()).then((mo) => setMolds(Array.isArray(mo.molds) ? mo.molds : [])).catch(() => {});
  }, []);

  // Snapshot → paint → bounded read (90 s) → keep what is on screen when the
  // answer fails: a failed read must not read as «no entries today», which is
  // a different and much worse statement. One hook since cleanup batch 7.
  const { data: runs, loading, failed, reload: load } = useRemembered<RunRow[]>({
    key: LAST_KEY,
    read: () => timedJson<RunRow[]>(fetch, "/api/runs"),
    valid: (snap) => Array.isArray(snap),
    onSettled: loadLists,
  });

  const fmt = (n: number) => fmtNum(n, isAr);
  const numberByName = useMemo(() => moldsByName(molds), [molds]);
  const nameOf = (r: RunRow) => productOf(r, molds);
  const numberOf = (r: RunRow) => moldNumberOf(r, numberByName);
  const shiftLabel = (s: string) => localize(s, SHIFTS, p.runs.shifts);
  /** Every label the shared log-run modal prints — one table, two pages. */
  const logLabels = {
    title: a.quality.add,
    date: p.runs.date, shift: p.runs.shift, shifts: p.runs.shifts as unknown as string[],
    machine: p.runs.machine, mold: p.runs.mold, planned: p.runs.planned,
    good: p.runs.good, scrap: p.runs.scrap, openCav: p.runs.openCav,
    downtime: p.runs.downtime, reason: p.runs.reason, reasons: p.runs.reasons as unknown as string[],
    operator: p.runs.operator, note: p.runs.note,
    select: p.common.select, save: p.common.save, cancel: p.common.cancel,
    reasonRequired: p.runs.reasonRequired, saveFailed: p.runs.saveFailed,
  };

  // Nothing on screen and nothing came back — the error box, now with a way out.
  if (runs === null && failed) {
    return (
      <div dir={isAr ? "rtl" : "ltr"} className="max-w-5xl">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">{a.quality.title}</h1>
          <p className="text-sm text-gray-500">{a.quality.subtitle}</p>
        </div>
        <LoadError
          variant="empty"
          text={failed?.timedOut ? p.common.timedOut : p.common.loadError}
          retry={p.common.retry}
          onRetry={load}
          loading={loading}
        />
      </div>
    );
  }
  if (runs === null) return <div className="flex justify-center py-16"><Spinner text={p.common.loading} /></div>;

  const dayRuns = runs.filter((r) => r.date === date);
  const good = dayRuns.reduce((s, r) => s + (r.goodUnits || 0), 0);
  const scrap = dayRuns.reduce((s, r) => s + (r.scrapUnits || 0), 0);
  const downtime = dayRuns.reduce((s, r) => s + (r.downtimeMin || 0), 0);
  const scrapRate = good + scrap ? ((scrap / (good + scrap)) * 100).toFixed(1) : "0.0";

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="max-w-5xl">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">{a.quality.title}</h1>
        <p className="text-sm text-gray-500">{a.quality.subtitle}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Btn onClick={() => setOpen(true)}><Plus size={15} /> {a.quality.add}</Btn>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm text-gray-600">{a.quality.date}</label>
            <input type="date" className={`${inputCls} w-auto`} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
      </div>

      {/* The read stalled but the day's entries are on screen — keep them, say
          why the numbers are not moving, and offer the retry. */}
      {failed && (
        <LoadError
          className="mb-4"
          text={failed.timedOut ? p.common.timedOut : p.common.loadError}
          note={p.common.slowSheet}
          retry={p.common.retry}
          onRetry={load}
          loading={loading}
        />
      )}
      {!failed && loading && <p className="mb-4 text-xs text-gray-400">{p.common.stillLoading}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
        <Stat label={a.quality.dayGood} value={fmt(good)} tone="green" />
        <Stat label={a.quality.dayScrap} value={fmt(scrap)} tone={scrap > 0 ? "red" : undefined} />
        <Stat label={a.quality.dayScrapRate} value={`${scrapRate}%`} tone={Number(scrapRate) > 3 ? "amber" : undefined} />
        <Stat label={a.quality.dayDowntime} value={fmt(downtime)} sub={a.quality.min} />
      </div>

      {dayRuns.length === 0 ? (
        <EmptyState text={a.quality.noEntries} />
      ) : (
        <>
        {/* Phone: stacked entry cards */}
        <div className="md:hidden space-y-3">
          {dayRuns.map((r) => {
            const tot = (r.goodUnits || 0) + (r.scrapUnits || 0);
            const rate = tot ? ((r.scrapUnits / tot) * 100).toFixed(1) : "0.0";
            return (
              <div key={r.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3">
                <div className="flex items-center justify-between gap-3 min-w-0">
                  <span className="font-medium text-gray-900 leading-snug min-w-0 truncate" dir="ltr">{r.machineCode || r.machine || "—"}</span>
                  <span className={`text-xs font-medium shrink-0 tabular-nums ${Number(rate) > 3 ? "text-amber-600" : "text-gray-400"}`}>
                    {rate}%
                  </span>
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {nameOf(r)}
                  {numberOf(r) ? <> · {p.runs.moldNumber} <span dir="ltr" className="font-mono">{numberOf(r)}</span></> : null}
                  {r.shift ? ` · ${shiftLabel(r.shift)}` : ""}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm mt-2">
                  <span className="text-green-600 font-medium">{fmt(r.goodUnits)} ✓</span>
                  {r.scrapUnits ? <span className="text-red-500">{fmt(r.scrapUnits)} ✗</span> : null}
                  {r.downtimeMin ? (
                    <span className="text-gray-500">
                      {fmt(r.downtimeMin)} {a.quality.min}
                      {r.downtimeReason && r.downtimeReason !== "None"
                        ? ` · ${downtimeReasonLabel(r.downtimeReason, isAr)}`
                        : ""}
                    </span>
                  ) : null}
                </div>
                {r.operator ? <div className="text-xs text-gray-400 mt-1">{r.operator}</div> : null}
              </div>
            );
          })}
        </div>
        {/* Desktop: the table */}
        <div className="hidden md:block bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/50">
                <th className="text-start px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{a.quality.machine}</th>
                <th className="text-start px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{p.runs.mold}</th>
                <th className="text-start px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{p.runs.shift}</th>
                <th className="text-end px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{a.quality.good}</th>
                <th className="text-end px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{a.quality.scrap}</th>
                <th className="text-end px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{a.quality.scrapRate}</th>
                <th className="text-start px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{a.quality.downtime}</th>
                <th className="text-start px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{a.quality.operator}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {dayRuns.map((r) => {
                const tot = (r.goodUnits || 0) + (r.scrapUnits || 0);
                const rate = tot ? ((r.scrapUnits / tot) * 100).toFixed(1) : "0.0";
                return (
                  <tr key={r.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap" dir="ltr">{r.machineCode || r.machine || "—"}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {nameOf(r)}
                      {numberOf(r) ? <span dir="ltr" className="ms-2 font-mono text-xs text-gray-400">{numberOf(r)}</span> : null}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{r.shift ? shiftLabel(r.shift) : "—"}</td>
                    <td className="px-4 py-3 text-green-600 font-medium text-end tabular-nums">{fmt(r.goodUnits)}</td>
                    <td className="px-4 py-3 text-red-500 text-end tabular-nums">{r.scrapUnits ? fmt(r.scrapUnits) : "—"}</td>
                    <td className={`px-4 py-3 text-end tabular-nums ${Number(rate) > 3 ? "text-amber-600" : "text-gray-500"}`}>{rate}%</td>
                    <td className="px-4 py-3 text-gray-500 tabular-nums">
                      {r.downtimeMin ? `${fmt(r.downtimeMin)} ${a.quality.min}` : "—"}
                      {r.downtimeMin && r.downtimeReason && r.downtimeReason !== "None"
                        ? ` · ${downtimeReasonLabel(r.downtimeReason, isAr)}`
                        : ""}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{r.operator || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
        </>
      )}

      {/* Log entry modal — shared with the production log (lib/run-row.ts). */}
      <LogRunModal
        open={open}
        onClose={() => setOpen(false)}
        onSaved={load}
        machines={machines}
        molds={molds}
        defaultDate={date}
        labels={logLabels}
        isAr={isAr}
      />
    </div>
  );
}
