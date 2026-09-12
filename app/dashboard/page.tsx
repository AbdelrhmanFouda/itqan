"use client";
import { usePageTitle } from "@/components/dashboard/use-page-title";
import { useLang } from "@/context/LangContext";
import { pd } from "@/lib/i18n.prod";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Plus, BarChart3, AlertTriangle } from "lucide-react";
import { Stat, EmptyState, Spinner, LoadError } from "@/components/dashboard/ui";
import { authedFetch } from "@/lib/authed-fetch";
import { readLastSeen, writeLastSeen, timedJson } from "@/components/dashboard/last-seen";
import { LOCALE_AR } from "@/lib/format";

type Machine = { name: string; status: string };
type Job = { id: string; code: string; status: string; dueDate: string };
type Run = {
  id: string;
  machine: string;
  machineCode?: string;
  mold: string;
  product: string;
  date: string;
  goodUnits: number;
  scrapUnits: number;
  downtimeMin: number;
};

type StaleEvent = { id: string; date: string; machine: string; reason: string; startedAt: number };

/**
 * Everything this page paints, as this device last saw it. One key rather than
 * four: the pieces are only meaningful together (the tiles are read as one
 * picture), and one localStorage write is cheaper than four.
 */
type Snap = { runs: Run[]; jobs: Job[]; machines: Machine[]; stale: StaleEvent[]; lastDowntimeLog: string };
const LAST_KEY = "itqan.overview.last";
/** Why the live read is not moving. Kept as a KIND, so the message follows the language. */
type Issue = "" | "timeout" | "error";

const OPERATIONAL = ["Operational", "تعمل", "Active"];
const DONE = ["Completed", "Delivered"];

export default function DashboardPage() {
  const { lang } = useLang();
  const p = pd[lang];
  const isAr = lang === "ar";
  usePageTitle(p.overview.title);

  // null = not answered yet. A tile reads «…» rather than a zero it cannot
  // stand behind — "0 machines operational" is a statement, not a placeholder.
  const [machines, setMachines] = useState<Machine[] | null>(null);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [runs, setRuns] = useState<Run[] | null>(null);
  // Stoppages started on the floor and never stopped. They carry no minutes, so
  // they are absent from Availability — the owner has to see that here, not
  // only on the entry page the floor uses.
  const [stale, setStale] = useState<StaleEvent[]>([]);
  // "" until the guarded fetch answers; the tile only renders on a real date.
  const [lastDowntimeLog, setLastDowntimeLog] = useState("");
  const [issue, setIssue] = useState<Issue>("");
  const [loading, setLoading] = useState(false);

  // The snapshot is written from here, not from render: the pieces land at
  // different times and only the ones that really came back should be kept.
  const snap = useRef<Snap>({ runs: [], jobs: [], machines: [], stale: [], lastDowntimeLog: "" });
  const remember = useCallback(() => writeLastSeen(LAST_KEY, snap.current), []);

  const load = useCallback(async () => {
    setLoading(true);
    /* ---- the main read: the numbers this page is about --------------------
     * Both are bounded (90s — there was no client timeout at all, so a stalled
     * bridge meant a spinner until the platform killed the function at 300s),
     * and a failure NEVER replaces what is on screen: the device snapshot or
     * the previous live answer stays and the page says why.
     *
     * `?quick=1` answers from Firestore alone, with no sheet read (see
     * app/api/downtime/route.ts): it carries the running/stale stoppages but
     * NOT `lastLoggedDate`, which needs «التوقفات». The unclosed-stoppage
     * banner sits above every number here and qualifies all of them, so it is
     * fetched in this phase — sub-second, and it queues no tab read. The full
     * answer follows below, only for the days-since-last-log tile.
     */
    const [rr, jr, dq] = await Promise.all([
      timedJson<Run[]>(fetch, "/api/runs"),
      timedJson<{ jobs?: Job[] }>(authedFetch, "/api/jobs"),
      timedJson<{ stale?: StaleEvent[] }>(authedFetch, "/api/downtime?quick=1"),
    ]);
    let bad: Issue = "";
    if (rr.ok && Array.isArray(rr.data)) { setRuns(rr.data); snap.current.runs = rr.data; }
    else bad = !rr.ok && rr.timedOut ? "timeout" : "error";
    if (jr.ok) { const j = jr.data.jobs ?? []; setJobs(j); snap.current.jobs = j; }
    else if (!bad) bad = jr.timedOut ? "timeout" : "error";
    if (dq.ok) { const s = dq.data.stale ?? []; setStale(s); snap.current.stale = s; }
    setIssue(bad);
    setLoading(false);
    remember();

    /* ---- the rest, AFTER the main read, never blocking it -----------------
     * The bridge serves one tab at a time, so «الماكينات» and «التوقفات»
     * started alongside simply queued in front of «الإنتاج» and «أوامر العمل».
     * Neither of these two carries a headline number: the registry fills the
     * machine tile's denominator, and the full downtime answer is read ONLY
     * for `lastLoggedDate` (the days-since-last-stoppage tile).
     */
    fetch("/api/machines").then((r) => r.json()).then((m) => {
      const list: Machine[] = m.machines ?? [];
      setMachines(list); snap.current.machines = list; remember();
    }).catch(() => {});
    authedFetch("/api/downtime").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return;
      const s: StaleEvent[] = d.stale ?? [];
      const last: string = d.lastLoggedDate ?? "";
      setStale(s); setLastDowntimeLog(last);
      snap.current.stale = s; snap.current.lastDowntimeLog = last;
      remember();
    }).catch(() => {});
  }, [remember]);

  useEffect(() => {
    // What this device saw last time paints at once; the live answers replace
    // it piece by piece. The page used to show a spinner for the whole bridge
    // round trip — 10–160s on a cold instance.
    const s = readLastSeen<Snap>(LAST_KEY);
    if (s) {
      const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
      snap.current = {
        runs: arr<Run>(s.runs), jobs: arr<Job>(s.jobs), machines: arr<Machine>(s.machines),
        stale: arr<StaleEvent>(s.stale), lastDowntimeLog: s.lastDowntimeLog ?? "",
      };
      // The snapshot is written piece by piece, so an EMPTY list in it means
      // "that fetch never answered" — leave it unanswered («…») rather than
      // paint a zero the owner would read as a fact.
      if (snap.current.runs.length) setRuns(snap.current.runs);
      if (snap.current.jobs.length) setJobs(snap.current.jobs);
      if (snap.current.machines.length) setMachines(snap.current.machines);
      setStale(snap.current.stale);
      setLastDowntimeLog(snap.current.lastDowntimeLog);
    }
    load();
  }, [load]);

  const fmt = (n: number) => n.toLocaleString(isAr ? LOCALE_AR : "en-US");

  // Checked BEFORE the loading gate: a failed runs fetch leaves `runs` null,
  // so the spinner below would otherwise spin forever. With a snapshot on the
  // device `runs` is NOT null, so the page renders and the failure becomes the
  // line below the header instead of a wall.
  if (runs === null && issue !== "") {
    return (
      <div dir={isAr ? "rtl" : "ltr"} className="max-w-5xl">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">{p.overview.title}</h1>
          <p className="text-sm text-gray-500">{p.overview.subtitle}</p>
        </div>
        <LoadError
          variant="empty"
          text={issue === "timeout" ? p.common.timedOut : p.common.loadError}
          retry={p.common.retry}
          onRetry={load}
          loading={loading}
        />
      </div>
    );
  }

  // Loading gate — presentation only: until the runs fetch resolves, show a
  // spinner instead of zero-filled stats (matches every sibling page).
  if (runs === null) {
    return (
      <div dir={isAr ? "rtl" : "ltr"} className="max-w-5xl">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">{p.overview.title}</h1>
          <p className="text-sm text-gray-500">{p.overview.subtitle}</p>
        </div>
        <div className="flex justify-center py-16">
          <Spinner text={p.common.loading} />
        </div>
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const ym = today.slice(0, 7);

  // «…» while a list has not answered — a zero here would read as a fact.
  const PENDING = "…";
  const operational = machines ? machines.filter((m) => OPERATIONAL.includes(m.status)).length : null;
  const activeJobs = jobs ? jobs.filter((j) => j.status === "In Production").length : null;
  const overdue = jobs
    ? jobs.filter((j) => !DONE.includes(j.status) && j.dueDate && j.dueDate < today).length
    : null;

  // Days since the last «التوقفات» row. Capture going quiet is invisible by
  // nature — it looks exactly like nothing breaking — so the gap is surfaced
  // here where the owner looks daily. (24→27 Aug 2026 went unnoticed this way.)
  const daysSinceDowntimeLog = lastDowntimeLog
    ? Math.max(0, Math.floor((Date.parse(today) - Date.parse(lastDowntimeLog)) / 86_400_000))
    : null;

  const monthRuns = runs.filter((r) => (r.date || "").startsWith(ym));
  const good = monthRuns.reduce((s, r) => s + (r.goodUnits || 0), 0);
  const scrap = monthRuns.reduce((s, r) => s + (r.scrapUnits || 0), 0);
  const downtime = monthRuns.reduce((s, r) => s + (r.downtimeMin || 0), 0);
  const scrapRate = good + scrap ? ((scrap / (good + scrap)) * 100).toFixed(1) : "0.0";

  // Top machines this month by good units
  const byMachine: Record<string, number> = {};
  for (const r of monthRuns) {
    const key = r.machineCode || r.machine || "—";
    byMachine[key] = (byMachine[key] ?? 0) + (r.goodUnits || 0);
  }
  const topMachines = Object.entries(byMachine)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const topMax = topMachines.length ? topMachines[0][1] : 0;

  const recent = runs.slice(0, 6);

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="max-w-5xl">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">{p.overview.title}</h1>
        <p className="text-sm text-gray-500">{p.overview.subtitle}</p>
      </div>

      {/* The read stalled but there are numbers on screen — keep them, say why
          they are not moving, and offer the retry. */}
      {issue !== "" && (
        <LoadError
          className="mb-6"
          text={issue === "timeout" ? p.common.timedOut : p.common.loadError}
          note={p.common.slowSheet}
          retry={p.common.retry}
          onRetry={load}
          loading={loading}
        />
      )}
      {issue === "" && loading && <p className="mb-6 text-xs text-gray-400">{p.common.stillLoading}</p>}

      {/* Unclosed stoppages. Deliberately ABOVE the stats: every number below
          assumes downtime is fully logged, and this is the case where it is not. */}
      {stale.length > 0 && (
        <div className="mb-8 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle size={18} className="text-amber-600 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold text-amber-900">
                {p.downtime.staleTitle} ({fmt(stale.length)})
              </p>
              <p className="text-sm text-amber-800 mt-0.5">{p.downtime.staleBody}</p>
              <ul className="mt-2 space-y-0.5 text-sm text-amber-900">
                {stale.slice(0, 4).map((e) => (
                  <li key={e.id}>
                    <span className="font-medium">{e.machine}</span> · {e.date}
                  </li>
                ))}
                {stale.length > 4 && <li>…</li>}
              </ul>
              <Link
                href="/dashboard/downtime"
                className="inline-flex items-center mt-2 min-h-11 sm:min-h-0 py-1 text-sm font-medium text-amber-900 underline rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1"
              >
                {p.downtime.staleReview}
              </Link>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-8">
        <Stat
          label={p.overview.operationalMachines}
          value={operational === null ? PENDING : fmt(operational)}
          sub={`${p.overview.ofTotal} ${machines ? fmt(machines.length) : PENDING}`}
        />
        <Stat label={p.overview.activeJobs} value={activeJobs === null ? PENDING : fmt(activeJobs)} />
        <Stat
          label={p.overview.overdueJobs}
          value={overdue === null ? PENDING : fmt(overdue)}
          tone={overdue !== null && overdue > 0 ? "red" : undefined}
        />
        {daysSinceDowntimeLog !== null && (
          <Stat
            label={p.overview.lastDowntimeLog}
            value={fmt(daysSinceDowntimeLog)}
            sub={`${p.overview.daysAgo} · ${lastDowntimeLog}`}
            tone={daysSinceDowntimeLog > 2 ? "amber" : undefined}
          />
        )}
        <Stat label={p.overview.unitsThisMonth} value={fmt(good)} />
        <Stat
          label={p.overview.scrapThisMonth}
          value={`${scrapRate}%`}
          tone={Number(scrapRate) > 3 ? "amber" : undefined}
        />
        <Stat label={p.overview.downtimeThisMonth} value={fmt(downtime)} sub={p.overview.minutes} />
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-10">
        <Link
          href="/dashboard/production"
          className="inline-flex items-center justify-center gap-1.5 min-h-11 sm:min-h-0 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-sm px-4 py-2 rounded-lg font-medium shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1"
        >
          <Plus size={15} /> {p.overview.logProduction}
        </Link>
        <Link
          href="/dashboard/jobs"
          className="inline-flex items-center justify-center gap-1.5 min-h-11 sm:min-h-0 border border-gray-300 hover:bg-gray-50 active:bg-gray-100 text-gray-700 text-sm px-4 py-2 rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1"
        >
          <Plus size={15} /> {p.overview.newJob}
        </Link>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Top machines */}
        <div>
          <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <BarChart3 size={16} className="text-blue-600" />
            {p.overview.topMachines}
          </h2>
          {topMachines.length === 0 ? (
            <EmptyState text={p.overview.noData} />
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5 space-y-3">
              {topMachines.map(([mid, units]) => (
                <div key={mid}>
                  <div className="flex items-center justify-between gap-3 text-xs mb-1">
                    <span className="font-medium text-gray-800 min-w-0 truncate">{mid}</span>
                    <span className="text-gray-500 shrink-0 tabular-nums">{fmt(units)} {p.overview.units}</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden" dir="ltr">
                    <div
                      className="h-full bg-blue-500 rounded-full"
                      style={{ width: `${topMax ? (units / topMax) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent production */}
        <div>
          <h2 className="text-sm font-semibold text-gray-900 mb-3">{p.overview.recentRuns}</h2>
          {recent.length === 0 ? (
            <EmptyState text={p.overview.noData} />
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
              {recent.map((r) => (
                <div key={r.id} className="px-4 sm:px-5 py-3 flex items-center justify-between gap-3 text-sm min-w-0">
                  <div className="min-w-0 truncate">
                    <span className="font-medium text-gray-800">{r.product || r.mold || "—"}</span>
                    <span className="text-gray-400"> · {r.machine || "—"}</span>
                  </div>
                  <div className="shrink-0 text-end text-gray-500 tabular-nums">
                    <span className="text-green-600 font-medium">{fmt(r.goodUnits)}</span>
                    {r.scrapUnits > 0 && <span className="text-red-500"> / {fmt(r.scrapUnits)}</span>}
                    <span className="text-gray-400 text-xs block">{r.date}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
