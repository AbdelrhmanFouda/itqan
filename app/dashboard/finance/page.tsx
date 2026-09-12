"use client";
import { usePageTitle } from "@/components/dashboard/use-page-title";
/**
 * Finance reads TWO sheet-backed sources — «أوامر العمل» through /api/jobs and
 * «الإنتاج» through /api/runs — and a cold serverless instance answers each in
 * seconds, not milliseconds (measured 2026-09-09: 2–11 s per tab, and
 * /api/jobs reads four). So, the pattern from /dashboard/jobs and
 * /dashboard/stock:
 *
 *  - the last answer THIS DEVICE saw paints at once (`itqan.finance.last`);
 *  - every fetch is bounded (`timedJson`) — there is no spinner that waits for
 *    the platform to kill the function at 300 s any more;
 *  - the two sources are independent: whichever lands first fills the tiles
 *    that need only it, and a tile whose source has not arrived reads «…»,
 *    never a zero;
 *  - a failed or timed-out refresh NEVER replaces what is on screen — it adds
 *    a red line with a retry.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLang } from "@/context/LangContext";
import { ad } from "@/lib/i18n.auth";
import { pd } from "@/lib/i18n.prod";
import { authedFetch } from "@/lib/authed-fetch";
import { readLastSeen, timedJson, writeLastSeen } from "@/components/dashboard/last-seen";
import { Stat, Spinner, EmptyState, LoadError } from "@/components/dashboard/ui";
import { LOCALE_AR } from "@/lib/format";

type Job = { id: string; client: string; status: string; dueDate: string; produced: number };
type Run = { machine: string; date: string; goodUnits: number; scrapUnits: number; downtimeMin: number };
/** What the device remembers between visits — both halves, in one object. */
type Snap = { jobs: Job[]; runs: Run[] };

const DONE = ["Completed", "Delivered"];
const LAST_KEY = "itqan.finance.last";
/** A figure whose source has not answered yet. Never rendered as 0. */
const PENDING = "…";

function Bars({
  data, isAr, unit, percent, empty, pending, pendingText,
}: {
  data: { label: string; value: number }[];
  isAr: boolean;
  unit?: string;
  percent?: boolean;
  empty: string;
  /** The source behind this chart has not answered yet — «no data» would lie. */
  pending?: boolean;
  pendingText?: string;
}) {
  const fmt = (n: number) => Number(n || 0).toLocaleString(isAr ? LOCALE_AR : "en-US");
  if (pending)
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5 flex justify-center">
        <Spinner text={pendingText ?? ""} />
      </div>
    );
  if (data.length === 0) return <EmptyState text={empty} />;
  const max = data.reduce((m, d) => Math.max(m, d.value), 0);
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5 space-y-3">
      {data.map((d) => (
        <div key={d.label}>
          <div className="flex items-center justify-between gap-3 text-xs mb-1">
            <span className="font-medium text-gray-700 min-w-0 truncate">{d.label}</span>
            <span className="text-gray-500 tabular-nums shrink-0">{percent ? `${fmt(d.value)}%` : `${fmt(d.value)}${unit ? ` ${unit}` : ""}`}</span>
          </div>
          <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden" dir="ltr">
            <div className="h-full bg-blue-500 rounded-full" style={{ width: `${max ? (d.value / max) * 100 : 0}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function FinancePage() {
  const { lang } = useLang();
  const a = ad[lang];
  const p = pd[lang];
  const isAr = lang === "ar";
  usePageTitle(a.finance.title);
  // null = that source has not answered yet. An empty array is an ANSWER.
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<{ timedOut: boolean } | null>(null);
  /** Everything on screen came off this device, not off a live answer. */
  const [fromSnapshot, setFromSnapshot] = useState(false);

  // The last GOOD value of each half, so a snapshot write never drops the half
  // that did not refresh this time.
  const seen = useRef<Snap>({ jobs: [], runs: [] });

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(null);
    // Both go out at once and each paints on its own: the order tiles do not
    // wait for «الإنتاج», and the production tiles do not wait for the four
    // tabs behind /api/jobs.
    const jp = timedJson<{ jobs?: Job[] }>(authedFetch, "/api/jobs");
    const rp = timedJson<Run[]>(fetch, "/api/runs");
    void jp.then((res) => {
      if (!res.ok) return; // a failure must never blank what is already shown
      const list = res.data.jobs ?? [];
      seen.current = { ...seen.current, jobs: list };
      setJobs(list);
      setFromSnapshot(false);
    });
    void rp.then((res) => {
      if (!res.ok) return;
      const list = Array.isArray(res.data) ? res.data : [];
      seen.current = { ...seen.current, runs: list };
      setRuns(list);
      setFromSnapshot(false);
    });
    const [j, r] = await Promise.all([jp, rp]);
    if (j.ok || r.ok) writeLastSeen(LAST_KEY, seen.current);
    const bad = !j.ok ? j : !r.ok ? r : null;
    setFailed(bad ? { timedOut: bad.timedOut } : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    // What this device saw last time renders AT ONCE; the live answer replaces
    // it. A phone opening the page cold used to watch a spinner for the whole
    // bridge round trip.
    const snap = readLastSeen<Snap>(LAST_KEY);
    if (snap && Array.isArray(snap.jobs) && Array.isArray(snap.runs)) {
      seen.current = { jobs: snap.jobs, runs: snap.runs };
      setJobs(snap.jobs);
      setRuns(snap.runs);
      setFromSnapshot(true);
    }
    load();
  }, [load]);

  const fmt = (n: number) => Number(n || 0).toLocaleString(isAr ? LOCALE_AR : "en-US");
  /** A figure whose source is still out reads «…», never 0. */
  const fmtOr = (n: number, have: boolean) => (have ? fmt(n) : PENDING);

  // Nothing at all on screen: the existing error state, now with a retry.
  if (failed && jobs === null && runs === null) {
    return (
      <div dir={isAr ? "rtl" : "ltr"} className="max-w-5xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">{a.finance.title}</h1>
        <LoadError
          variant="empty"
          text={failed.timedOut ? p.common.timedOut : p.common.loadError}
          retry={p.common.retry}
          onRetry={load}
        />
      </div>
    );
  }
  if (jobs === null && runs === null) return <div className="flex justify-center py-16"><Spinner text={p.common.loading} /></div>;

  const jobList = jobs ?? [];
  const runList = runs ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const ym = today.slice(0, 7);
  const monthRuns = runList.filter((r) => (r.date || "").startsWith(ym));
  const goodAll = runList.reduce((s, r) => s + (r.goodUnits || 0), 0);
  const goodMonth = monthRuns.reduce((s, r) => s + (r.goodUnits || 0), 0);
  const scrapMonth = monthRuns.reduce((s, r) => s + (r.scrapUnits || 0), 0);
  const downtimeMonth = monthRuns.reduce((s, r) => s + (r.downtimeMin || 0), 0);
  const scrapRate = goodMonth + scrapMonth ? ((scrapMonth / (goodMonth + scrapMonth)) * 100).toFixed(1) : "0.0";
  const activeJobs = jobList.filter((j) => j.status === "In Production").length;
  const overdue = jobList.filter((j) => !DONE.includes(j.status) && j.dueDate && j.dueDate < today).length;

  // by month
  const monthMap: Record<string, { good: number; scrap: number }> = {};
  for (const r of runList) {
    const k = (r.date || "").slice(0, 7);
    if (!k) continue;
    if (!monthMap[k]) monthMap[k] = { good: 0, scrap: 0 };
    monthMap[k].good += r.goodUnits || 0;
    monthMap[k].scrap += r.scrapUnits || 0;
  }
  const months = Object.keys(monthMap).sort().slice(-6);
  // Presentation only: "2026-08" → "Aug 2026" / "أغسطس ٢٠٢٦"
  const monthLabel = (k: string) =>
    new Date(k + "-01T00:00").toLocaleDateString(isAr ? LOCALE_AR : "en-US", { month: "short", year: "numeric" });
  const goodByMonth = months.map((k) => ({ label: monthLabel(k), value: monthMap[k].good }));
  const scrapByMonth = months.map((k) => {
    const tot = monthMap[k].good + monthMap[k].scrap;
    return { label: monthLabel(k), value: tot ? Number(((monthMap[k].scrap / tot) * 100).toFixed(1)) : 0 };
  });

  // produced per job (computed by the API) → by client / by machine
  const clientMap: Record<string, number> = {};
  for (const j of jobList) {
    const v = j.produced || 0;
    if (v && j.client) clientMap[j.client] = (clientMap[j.client] ?? 0) + v;
  }
  const byClient = Object.entries(clientMap).map(([label, value]) => ({ label, value })).sort((x, y) => y.value - x.value).slice(0, 6);

  const machMap: Record<string, number> = {};
  for (const r of runList) {
    const key = r.machine || "—";
    machMap[key] = (machMap[key] ?? 0) + (r.goodUnits || 0);
  }
  const byMachine = Object.entries(machMap).map(([label, value]) => ({ label, value })).sort((x, y) => y.value - x.value).slice(0, 6);

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="max-w-5xl">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">{a.finance.title}</h1>
        <p className="text-sm text-gray-500">{a.finance.subtitle}</p>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800 mb-8">
        {a.finance.note}
      </div>

      {/* A refresh that failed keeps the numbers and says so — it never blanks
          the page, and it never leaves an endless spinner. */}
      {failed && (
        <LoadError
          className="mb-3"
          text={failed.timedOut ? p.common.timedOut : p.common.loadError}
          retry={p.common.retry}
          onRetry={load}
        />
      )}
      {failed && fromSnapshot && <p className="text-xs text-amber-700 mb-3">{p.common.slowSheet}</p>}
      {loading && fromSnapshot && !failed && <p className="text-xs text-gray-400 mb-3">{p.common.stillLoading}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-8">
        <Stat label={a.finance.goodAll} value={fmtOr(goodAll, runs !== null)} />
        <Stat label={a.finance.goodMonth} value={fmtOr(goodMonth, runs !== null)} />
        <Stat label={a.finance.scrapRate} value={runs === null ? PENDING : `${scrapRate}%`} tone={runs !== null && Number(scrapRate) > 3 ? "amber" : undefined} />
        <Stat label={a.finance.downtime} value={fmtOr(downtimeMonth, runs !== null)} sub={a.finance.min} />
        <Stat label={a.finance.activeJobs} value={fmtOr(activeJobs, jobs !== null)} />
        <Stat label={a.finance.overdue} value={fmtOr(overdue, jobs !== null)} tone={jobs !== null && overdue > 0 ? "red" : undefined} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 mb-3">{a.finance.byMonth}</h2>
          <Bars data={goodByMonth} isAr={isAr} unit={a.finance.units} empty={a.finance.noData} pending={runs === null} pendingText={p.common.loading} />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-900 mb-3">{a.finance.scrapByMonth}</h2>
          <Bars data={scrapByMonth} isAr={isAr} percent empty={a.finance.noData} pending={runs === null} pendingText={p.common.loading} />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-900 mb-3">{a.finance.byClient}</h2>
          <Bars data={byClient} isAr={isAr} unit={a.finance.units} empty={a.finance.noData} pending={jobs === null} pendingText={p.common.loading} />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-900 mb-3">{a.finance.byMachine}</h2>
          <Bars data={byMachine} isAr={isAr} unit={a.finance.units} empty={a.finance.noData} pending={runs === null} pendingText={p.common.loading} />
        </div>
      </div>
    </div>
  );
}
