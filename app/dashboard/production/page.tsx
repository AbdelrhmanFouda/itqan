"use client";
import { usePageTitle } from "@/components/dashboard/use-page-title";
import { useLang } from "@/context/LangContext";
import { pd } from "@/lib/i18n.prod";
import { useState, useCallback, useMemo, useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Stat, Btn, EmptyState, Spinner, LoadError } from "@/components/dashboard/ui";
import { SHIFTS, downtimeReasonLabel, localize } from "@/lib/prod-meta";
import { authedFetch } from "@/lib/authed-fetch";
import { timedJson } from "@/components/dashboard/last-seen";
import { useRemembered } from "@/components/dashboard/use-remembered";
import { moldsByName, moldNumberOf, productOf, type MachineRow, type MoldRow, type RunRow } from "@/lib/run-row";
import { LogRunModal } from "@/components/dashboard/log-run-modal";
import { fmtNum } from "@/lib/format";
import { todayIso } from "@/lib/dates";


/** The last «الإنتاج» answer this device saw — painted at once on the next open. */
const LAST_KEY = "itqan.runs.last";
export default function ProductionPage() {
  const { lang } = useLang();
  const p = pd[lang];
  const isAr = lang === "ar";
  usePageTitle(p.runs.title);

  const [molds, setMolds] = useState<MoldRow[]>([]);
  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [period, setPeriod] = useState<"month" | "all">("month");
  const [open, setOpen] = useState(false);

  const today = todayIso();
  const ym = today.slice(0, 7);


  // The two lists that only feed the log-production form («الرئيسي» for the
  // mould numbers, «الماكينات» for the registry) are started AFTER the log has
  // answered, and only once. The bridge serves one tab at a time: firing them
  // first (as this page did until 2026-09-10) put two cold tab reads — 2–11s
  // each — in front of the read the table itself is waiting for. Nothing here
  // blocks the table, and a failure leaves the dropdown empty, not the page.
  const listsStarted = useRef(false);
  const loadLists = useCallback(() => {
    if (listsStarted.current) return;
    listsStarted.current = true;
    // Master (guarded) rather than the open «الاسطمبات» view: only Master
    // carries the notes column where 26 products keep their mould number.
    authedFetch("/api/molds").then((x) => x.json()).then((mo) => setMolds(Array.isArray(mo.molds) ? mo.molds : [])).catch(() => {});
    fetch("/api/machines").then((x) => x.json()).then((ma) => setMachines(ma.machines ?? [])).catch(() => {});
  }, []);

  // Snapshot → paint → bounded read (90 s) → keep what is on screen when the
  // answer fails. One hook for all of it since cleanup batch 7; the bridge can
  // take 10–160 s on a cold instance and there used to be no client timeout.
  const { data: runs, loading, failed, reload: load } = useRemembered<RunRow[]>({
    key: LAST_KEY,
    read: () => timedJson<RunRow[]>(fetch, "/api/runs"),
    valid: (snap) => Array.isArray(snap),
    onSettled: loadLists,
  });

  async function handleDelete(id: string) {
    if (!confirm(p.common.confirmDelete)) return;
    await authedFetch(`/api/runs/${id}`, { method: "DELETE" });
    load();
  }

  const fmt = (n: number) => fmtNum(n, isAr);
  const numberByName = useMemo(() => moldsByName(molds), [molds]);
  const nameOf = (r: RunRow) => productOf(r, molds);
  const numberOf = (r: RunRow) => moldNumberOf(r, numberByName);
  const shiftLabel = (s: string) => localize(s, SHIFTS, p.runs.shifts);
  /** Every label the shared log-run modal prints — one table, two pages. */
  const logLabels = {
    title: p.runs.add,
    date: p.runs.date, shift: p.runs.shift, shifts: p.runs.shifts as unknown as string[],
    machine: p.runs.machine, mold: p.runs.mold, planned: p.runs.planned,
    good: p.runs.good, scrap: p.runs.scrap, openCav: p.runs.openCav,
    downtime: p.runs.downtime, reason: p.runs.reason, reasons: p.runs.reasons as unknown as string[],
    operator: p.runs.operator, note: p.runs.note,
    select: p.common.select, save: p.common.save, cancel: p.common.cancel,
    reasonRequired: p.runs.reasonRequired, saveFailed: p.runs.saveFailed,
  };

  const scope = (runs ?? []).filter((r) => (period === "all" ? true : (r.date || "").startsWith(ym)));
  const good = scope.reduce((s, r) => s + (r.goodUnits || 0), 0);
  const scrap = scope.reduce((s, r) => s + (r.scrapUnits || 0), 0);
  const downtime = scope.reduce((s, r) => s + (r.downtimeMin || 0), 0);
  const scrapRate = good + scrap ? ((scrap / (good + scrap)) * 100).toFixed(1) : "0.0";

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="max-w-5xl">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">{p.runs.title}</h1>
        <p className="text-sm text-gray-500">{p.runs.subtitle}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Btn onClick={() => setOpen(true)}><Plus size={15} /> {p.runs.add}</Btn>
          {/* Period toggle */}
          <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
            {(["month", "all"] as const).map((key) => (
              <button
                key={key}
                onClick={() => setPeriod(key)}
                className={`px-3 py-1.5 min-h-11 sm:min-h-0 inline-flex items-center rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
                  period === key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"
                }`}
              >
                {key === "month" ? p.runs.thisMonth : p.runs.allTime}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* The read stalled but there are numbers on screen — say so, keep them,
          and offer the retry. Never blank a log that was readable a moment ago. */}
      {runs !== null && failed && (
        <LoadError
          className="mb-4"
          text={failed.timedOut ? p.common.timedOut : p.common.loadError}
          note={p.common.slowSheet}
          retry={p.common.retry}
          onRetry={load}
          loading={loading}
        />
      )}
      {runs !== null && !failed && loading && (
        <p className="mb-4 text-xs text-gray-400">{p.common.stillLoading}</p>
      )}

      {/* Totals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
        <Stat label={p.runs.totalGood} value={fmt(good)} tone="green" />
        <Stat label={p.runs.totalScrap} value={fmt(scrap)} tone={scrap > 0 ? "red" : undefined} />
        <Stat label={p.runs.scrapRate} value={`${scrapRate}%`} tone={Number(scrapRate) > 3 ? "amber" : undefined} />
        <Stat label={p.runs.totalDowntime} value={fmt(downtime)} sub={p.overview.minutes} />
      </div>

      {runs === null ? (
        failed ? (
          // Nothing to show at all — the error box, with a way out.
          <LoadError
            variant="empty"
            text={failed.timedOut ? p.common.timedOut : p.common.loadError}
            retry={p.common.retry}
            onRetry={load}
            loading={loading}
          />
        ) : (
          <div className="flex justify-center py-16"><Spinner text={p.common.loading} /></div>
        )
      ) : runs.length === 0 ? (
        <EmptyState text={p.runs.empty} />
      ) : (
        <>
        {/* Phone: stacked run cards */}
        <div className="md:hidden space-y-3">
          {(runs ?? []).map((r) => (
            <div key={r.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3">
              <div className="flex items-center justify-between gap-3 min-w-0">
                <span className="font-medium text-gray-900 leading-snug min-w-0 truncate">
                  {nameOf(r)}
                  {numberOf(r) ? (
                    <span className="ms-2 text-xs font-normal text-gray-500 whitespace-nowrap">
                      {p.runs.moldNumber} <span dir="ltr" className="font-mono">{numberOf(r)}</span>
                    </span>
                  ) : null}
                </span>
                <button
                  onClick={() => handleDelete(r.id)}
                  aria-label={p.common.delete}
                  className="text-gray-300 hover:text-red-500 transition-colors shrink-0 p-2.5 -m-1.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {r.date}{r.shift ? ` · ${shiftLabel(r.shift)}` : ""} · {r.machineCode || r.machine || "—"}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm mt-2">
                <span className="text-green-600 font-medium">{fmt(r.goodUnits)} ✓</span>
                {r.scrapUnits ? <span className="text-red-500">{fmt(r.scrapUnits)} ✗</span> : null}
                {r.downtimeMin ? (
                  <span className="text-gray-500">
                    {fmt(r.downtimeMin)} {p.overview.minutes}
                    {r.downtimeReason && r.downtimeReason !== "None"
                      ? ` · ${downtimeReasonLabel(r.downtimeReason, isAr)}`
                      : ""}
                  </span>
                ) : null}
              </div>
              {r.operator ? <div className="text-xs text-gray-400 mt-1">{r.operator}</div> : null}
            </div>
          ))}
        </div>
        {/* Desktop: the table */}
        <div className="hidden md:block bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/50">
                <th className="text-start px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{p.runs.date}</th>
                <th className="text-start px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{p.runs.shift}</th>
                <th className="text-start px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{p.runs.mold}</th>
                <th className="text-start px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{p.runs.moldNumber}</th>
                <th className="text-start px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{p.runs.machine}</th>
                <th className="text-end px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{p.runs.good}</th>
                <th className="text-end px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{p.runs.scrap}</th>
                <th className="text-start px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{p.runs.downtime}</th>
                <th className="text-start px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{p.runs.operator}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(runs ?? []).map((r) => (
                <tr key={r.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap tabular-nums" dir="ltr">{r.date}</td>
                  <td className="px-4 py-3 text-gray-500">{r.shift ? shiftLabel(r.shift) : "—"}</td>
                  <td className="px-4 py-3 font-medium text-gray-800">{nameOf(r)}</td>
                  <td className="px-4 py-3 text-gray-600 font-mono tabular-nums whitespace-nowrap" dir="ltr">{numberOf(r) || "—"}</td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap" dir="ltr">{r.machineCode || r.machine || "—"}</td>
                  <td className="px-4 py-3 text-green-600 font-medium text-end tabular-nums">{fmt(r.goodUnits)}</td>
                  <td className="px-4 py-3 text-red-500 text-end tabular-nums">{r.scrapUnits ? fmt(r.scrapUnits) : "—"}</td>
                  <td className="px-4 py-3 text-gray-500 tabular-nums">
                    {r.downtimeMin ? `${fmt(r.downtimeMin)} ${p.overview.minutes}` : "—"}
                    {r.downtimeMin && r.downtimeReason && r.downtimeReason !== "None"
                      ? ` · ${downtimeReasonLabel(r.downtimeReason, isAr)}`
                      : ""}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{r.operator || "—"}</td>
                  <td className="px-4 py-3 text-end">
                    <button
                      onClick={() => handleDelete(r.id)}
                      aria-label={p.common.delete}
                      className="min-w-9 min-h-9 inline-flex items-center justify-center rounded-lg text-gray-300 hover:text-red-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
        </>
      )}

      {/* Log production modal — shared with the quality log (lib/run-row.ts). */}
      <LogRunModal
        open={open}
        onClose={() => setOpen(false)}
        onSaved={load}
        machines={machines}
        molds={molds}
        defaultDate={today}
        showNote
        labels={logLabels}
        isAr={isAr}
      />
    </div>
  );
}
