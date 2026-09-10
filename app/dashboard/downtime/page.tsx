"use client";
import { usePageTitle } from "@/components/dashboard/use-page-title";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLang } from "@/context/LangContext";
import { useAuth } from "@/context/AuthContext";
import { pd } from "@/lib/i18n.prod";
import { Btn, Spinner, EmptyState, Stat } from "@/components/dashboard/ui";
import { authedFetch } from "@/lib/authed-fetch";
import { readLastSeen, writeLastSeen, timedJson } from "@/components/dashboard/last-seen";
import { DOWNTIME_CAPTURE_REASONS, ALL_DOWNTIME_REASONS } from "@/lib/prod-meta";
import { BACKDATE_STEP_MIN, BACKDATE_CAP_MIN } from "@/lib/downtime";
import { hasFullAccess } from "@/lib/roles";
import { LOCALE_AR } from "@/lib/format";

/**
 * PHASE 2 — downtime capture, built for a phone on the factory floor.
 *
 * FOUR TAPS, ZERO TYPING: machine → reason → start … → stop.
 *
 * The no-typing rule is not a style preference, it is what the data says. Six
 * «الإنتاج» columns that need typing — including «زمن التوقف» and «سبب التوقف» —
 * are empty across all 417 rows, while «تسجيل الإنتاج», which is picked and
 * tapped, has 20 unbroken days. Anything that asks a supervisor to type on a
 * phone next to a running press will be left blank, so nothing here does.
 *
 * Machine identity is the «الماكينات»!J label ("PQ 7 — 100") straight from the
 * registry — never tonnage alone, because PQ 5 and PQ 7 are both 100 t.
 */

type MachineInfo = { label: string; code: string; name: string; status: string };
type Event = {
  id: string; date: string; machine: string; reason: string;
  minutes: number; startedAt: number; endedAt: number | null; createdBy: string;
  estimated?: boolean;
  /** minutes the start was pulled back with «+30 دقيقة» — see backdate() below. */
  backdatedMin?: number;
};
type Data = { open: Event[]; stale: Event[]; today: Event[]; todayDate: string };
type OtherRow = { row: number; date: string; machine: string; minutes: number; notes: string };

const MACHINES_KEY = "itqan.downtime.machines"; // last machine list seen — see useState below
/**
 * Today's FINISHED list and its two tiles, as this device last saw them. That
 * half of the page comes from «التوقفات» — a sheet read, 10–160s on a cold
 * instance — and it used to sit behind «…» and a spinner for all of it. The
 * RUNNING list is deliberately NOT remembered: it comes from Firestore in well
 * under a second, and a remembered stoppage could show a machine as down after
 * somebody else stopped it (or leave its start button disabled), which the
 * four-tap flow must never do.
 */
const LAST_KEY = "itqan.downtime.last";
type TodaySnap = { today: Event[]; todayDate: string };

/** Big enough to hit with a work glove on. */
const TAP =
  "min-h-[64px] rounded-2xl border-2 px-4 py-3 text-lg font-semibold transition " +
  "active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1";

/**
 * Live duration of a running stoppage. Day-aware since 2026-08-20 (owner's
 * rule): a stoppage keeps recording across shift and day boundaries until
 * somebody taps stop, so the counter must be able to say "2 يوم 5:20", not
 * wrap into a meaningless "53:20 دقيقة".
 */
function elapsed(from: number, now: number, minWord: string, dayWord: string): string {
  const m = Math.max(0, Math.floor((now - from) / 60000));
  if (m < 60) return `${m} ${minWord}`;
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  if (h < 24) return `${h}:${mm}`;
  return `${Math.floor(h / 24)} ${dayWord} ${h % 24}:${mm}`;
}

export default function DowntimePage() {
  const { lang } = useLang();
  const { user, profile, loading: authLoading } = useAuth();
  const p = pd[lang];
  const t = p.downtime;
  const isAr = lang === "ar";
  usePageTitle(t.title);

  // The machine buttons are the START flow, and the registry is the slowest read
  // on the site when the cache has gone cold (9.5s measured, 2026-09-02). Show
  // the list seen last time at once and swap in the fresh one when it lands —
  // the registry has been renumbered four times in the project's life, never
  // between two taps.
  const [machines, setMachines] = useState<MachineInfo[] | null>(() => {
    try {
      const raw = localStorage.getItem(MACHINES_KEY);
      return raw ? (JSON.parse(raw) as MachineInfo[]) : null;
    } catch { return null; }
  });
  const [data, setData] = useState<Data | null>(null);
  // «today» comes from the sheet and arrives after the running list does
  const [todayLoaded, setTodayLoaded] = useState(false);
  // The finished list this device saw last time — shown only once the quick
  // answer confirms it belongs to the SAME factory day (see snapUsable below).
  const [todaySnap, setTodaySnap] = useState<TodaySnap | null>(null);
  const [todayErr, setTodayErr] = useState<"net" | "timeout" | null>(null);
  const [machine, setMachine] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loadErr, setLoadErr] = useState<"auth" | "role" | "net" | "timeout" | null>(null);
  // Ticks once a minute so a running stoppage counts up on its own.
  const [now, setNow] = useState(() => Date.now());
  // ---- Owner-only review of «أخرى» rows (never rendered for the floor) ----
  const role = profile?.role;
  const isBoss = !!role && hasFullAccess(role);
  const [others, setOthers] = useState<OtherRow[] | null>(null);
  const [reclassRow, setReclassRow] = useState<number | null>(null);
  const [reclassBusy, setReclassBusy] = useState(false);
  const [reclassErr, setReclassErr] = useState<"" | "save" | "rejected" | "changed">("");

  /**
   * Load the open/stale/today lists.
   *
   * This route is GUARDED (the rows carry createdBy), so unlike the other
   * dashboard reads it needs a token. Everything here exists because the first
   * version just did `if (res.ok) setData(...)`: any failure left `data` null,
   * the page returned a Spinner forever, and the operator got a screen that
   * never loaded and never said why. A guarded fetch on a phone fails for
   * ordinary reasons — the token is not restored yet, the session expired, the
   * signal dropped in the workshop — so it must fail LOUDLY and be retryable,
   * and it must never block the start flow, which needs no token to render.
   */
  /**
   * Two answers, not one. `?quick=1` is Firestore only — the running stoppages,
   * which is all that start and stop need — and comes back in well under a
   * second. The full answer adds today's finished list from «التوقفات», which
   * costs a sheet read that takes ~9.5s whenever the 45s cache has gone cold,
   * and it had been holding the whole screen behind a spinner.
   */
  const quickInFlight = useRef(false);
  const loadQuick = useCallback(async () => {
    if (quickInFlight.current) return false;
    quickInFlight.current = true;
    // Firestore only, so it answers in well under a second — bounded shorter
    // than a sheet read, because the floor is waiting on THIS one.
    const r = await timedJson<Pick<Data, "open" | "stale" | "todayDate">>(authedFetch, "/api/downtime?quick=1", {}, 30_000);
    quickInFlight.current = false;
    if (r.ok) {
      setData((prev) => ({ today: prev?.today ?? [], ...r.data }));
      setLoadErr(null);
      return true;
    }
    setLoadErr(r.timedOut ? "timeout" : r.status === 401 ? "auth" : r.status === 403 ? "role" : "net");
    return false;
  }, []);

  /**
   * Today's finished list, from «التوقفات». Bounded and never blocking: the
   * running lists and the start/stop buttons are already on screen, and a
   * failure here keeps whatever the device remembered rather than replacing it
   * with an empty list.
   */
  const fullInFlight = useRef(false);
  const loadFull = useCallback(async () => {
    if (fullInFlight.current) return;
    fullInFlight.current = true;
    const r = await timedJson<Data>(authedFetch, "/api/downtime");
    fullInFlight.current = false;
    if (!r.ok) { setTodayErr(r.timedOut ? "timeout" : "net"); return; }
    setData(r.data);
    setTodayLoaded(true);
    setTodayErr(null);
    writeLastSeen(LAST_KEY, { today: r.data.today ?? [], todayDate: r.data.todayDate });
  }, []);

  const load = useCallback(async () => {
    // The sheet half is fired, not awaited — a stop must not stay «busy» for
    // the length of a cold «التوقفات» read.
    if (await loadQuick()) void loadFull();
  }, [loadQuick, loadFull]);

  const machinesAsked = useRef(false);
  const refreshMachines = useCallback(async () => {
    if (machinesAsked.current) return;
    machinesAsked.current = true;
    const r = await timedJson<{ machines?: MachineInfo[] }>(fetch, "/api/machines");
    if (!r.ok) { setMachines((prev) => prev ?? []); return; }
    const list = r.data.machines ?? [];
    setMachines(list);
    try { localStorage.setItem(MACHINES_KEY, JSON.stringify(list)); } catch { /* private mode */ }
  }, []);

  // Wait for Firebase to restore the session before the authenticated call.
  // authedFetch reads auth.currentUser, which is null for the first moments
  // after a page load — calling too early is an automatic 401.
  useEffect(() => {
    if (authLoading) return;
    // Signed out: the guarded lists cannot load, but the machine buttons must
    // still render, so ask for the registry straight away.
    if (!user) { void refreshMachines(); return; }
    // ORDER MATTERS. «الماكينات» is a sheet read the bridge serialises (9.5s
    // cold, measured 2026-09-02) — started first it queued the running-stoppage
    // call behind it. The buttons come from the remembered list meanwhile.
    void loadQuick().then((ok) => {
      void refreshMachines();
      if (ok) void loadFull();
    });
  }, [authLoading, user, loadQuick, loadFull, refreshMachines]);

  // Today's finished list as this device last saw it, at once.
  useEffect(() => {
    const snap = readLastSeen<TodaySnap>(LAST_KEY);
    if (snap && Array.isArray(snap.today)) setTodaySnap(snap);
  }, []);

  const loadOthers = useCallback(async () => {
    const r = await timedJson<{ rows?: OtherRow[] }>(authedFetch, "/api/downtime/reclassify");
    if (r.ok) setOthers(r.data.rows ?? []);
  }, []);

  useEffect(() => {
    if (authLoading || !user || !isBoss) return;
    loadOthers();
  }, [authLoading, user, isBoss, loadOthers]);

  /** Owner review: write the real reason onto one «أخرى» row. */
  async function reclassify(r: OtherRow, reason: string) {
    if (reclassBusy) return;
    setReclassBusy(true); setReclassErr("");
    const res = await authedFetch("/api/downtime/reclassify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ row: r.row, date: r.date, machine: r.machine, minutes: r.minutes, reason }),
    }).catch(() => null);
    setReclassBusy(false);
    if (res?.ok) {
      setReclassRow(null);
      await loadOthers();
      return;
    }
    if (res?.status === 409) { setReclassErr("changed"); await loadOthers(); return; }
    const why = res ? ((await res.json().catch(() => ({}))) as { reason?: string }).reason : "";
    setReclassErr(why === "cell_rejected" ? "rejected" : "save");
  }

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Re-poll while something is running so a stop from another phone shows here.
  // Stoppages from a previous day count as running too — they keep recording.
  const runningCount = (data?.open.length ?? 0) + (data?.stale.length ?? 0);
  useEffect(() => {
    if (!runningCount) return;
    const id = setInterval(loadQuick, 30_000);
    return () => clearInterval(id);
  }, [runningCount, loadQuick]);

  async function start(reason: string) {
    if (!machine || busy) return;
    setBusy(true); setFailed(false);
    const res = await authedFetch("/api/downtime", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ machine, reason }),
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) { setFailed(true); return; }
    setMachine("");          // back to the machine list, ready for the next one
    await load();
  }

  async function exportCsv() {
    const res = await authedFetch("/api/downtime/export").catch(() => null);
    if (!res || !res.ok) { setFailed(true); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = "itqan-downtime.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Stop a running stoppage. Always a MEASURED stop, whichever day it started
   * on: a shift ending does not restart the machine (owner's rule, 2026-08-17),
   * and since 2026-08-20 a stoppage from a previous day is not closed "as
   * estimated" either — it simply keeps recording until this tap, and the
   * minutes run start → now. (`estimate: true` still exists server-side for a
   * deliberate owner review, but nothing on this page sends it any more.)
   */
  async function stop(id: string) {
    if (busy) return;
    setBusy(true); setFailed(false);
    const res = await authedFetch("/api/downtime", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) { setFailed(true); return; }
    await load();
  }

  /**
   * «+30 دقيقة» — owner's rule, 2026-09-07 meeting: the technician logged the
   * stoppage late, so each press pulls the START back one fixed step and the
   * running counter visibly jumps by that much — that jump IS the feedback.
   * The step and the 12-hour cap are enforced server-side (planBackdate);
   * the button also disables at the cap so the floor never sees a refusal.
   */
  async function backdate(id: string) {
    if (busy) return;
    setBusy(true); setFailed(false);
    const res = await authedFetch("/api/downtime", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, backdateMin: BACKDATE_STEP_MIN }),
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) { setFailed(true); return; }
    await loadQuick();
  }

  // Only the MACHINE LIST gates the page. If the guarded read failed we still
  // render, say why, and let the operator start a stoppage — the action that
  // matters must not be held hostage by a list that failed to load.
  if (machines === null || (data === null && loadErr === null)) {
    return <div className="flex justify-center py-16"><Spinner text={p.common.loading} /></div>;
  }

  // A stoppage started on a previous day is still RUNNING — it keeps recording
  // until somebody taps stop (owner's rule, 2026-08-20). The API still reports
  // the two lists separately (the owner surfaces use `stale`), but this page
  // shows them as one, longest-down first.
  const openList = [...(data?.stale ?? []), ...(data?.open ?? [])]
    .sort((a, b) => a.startedAt - b.startedAt);
  // The remembered finished list stands in ONLY while the live one is still
  // coming AND the quick answer says it is the same factory day — yesterday's
  // stoppages printed under «اليوم» would be a lie, not a stale number.
  const snapUsable = !todayLoaded && !!todaySnap && !!data?.todayDate && todaySnap.todayDate === data.todayDate;
  const todayList = todayLoaded ? (data?.today ?? []) : snapUsable && todaySnap ? todaySnap.today : (data?.today ?? []);
  const todayShown = todayLoaded || snapUsable;

  // A machine with an unclosed stoppage must not be startable again; that
  // would open a second event and double-count it. openList already includes
  // stoppages carried over from previous days.
  const openByMachine = new Set(openList.map((e) => e.machine));
  const lostToday = todayList.reduce((s, e) => s + e.minutes, 0);
  // ALL_ rather than CAPTURE_: today's finished list comes from «التوقفات» now,
  // and the tab holds reasons that are no longer offered as buttons («عطل»,
  // «خامة» — 3,147 minutes of migrated history). Looking only at the eight
  // buttons would print a bare English key on an Arabic page. The BUTTONS below
  // still come from DOWNTIME_CAPTURE_REASONS — the retired ones are readable,
  // not choosable.
  const reasonLabel = (key: string) => {
    const r = ALL_DOWNTIME_REASONS.find((x) => x.key === key);
    return r ? (isAr ? r.ar : r.en) : key;
  };

  return (
    <div className="max-w-3xl" dir={isAr ? "rtl" : "ltr"}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <h1 className="text-2xl font-bold text-gray-900">{t.title}</h1>
        {/* Not a plain <a>: the export route is guarded by a Bearer token, which
            a browser navigation cannot attach — it would 401. Fetch it
            authenticated, then hand the blob to a throwaway link. */}
        <button onClick={exportCsv} className="inline-flex items-center min-h-11 sm:min-h-0 px-2 -mx-2 rounded-lg text-sm text-blue-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1">
          {t.export}
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-6">{t.subtitle}</p>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-6 max-w-sm">
        <Stat label={t.todayMinutes} value={todayShown ? lostToday.toLocaleString(LOCALE_AR) : "…"} sub={t.minutes} tone={lostToday > 0 ? "amber" : undefined} />
        <Stat label={t.todayEvents} value={todayShown ? todayList.length.toLocaleString(LOCALE_AR) : "…"} />
      </div>

      {failed && (
        <div className="mb-4 rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3 text-red-700">
          {t.failed}
        </div>
      )}

      {/* The guarded list failed. Say which failure it was — "sign in again" and
          "no signal" need different actions from the operator — and offer a
          retry. The start buttons below still work. */}
      {loadErr && (
        <div className="mb-4 rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3">
          <p className="font-semibold text-amber-900">
            {loadErr === "auth" ? t.errAuth
              : loadErr === "role" ? t.errRole
              : loadErr === "timeout" ? p.common.timedOut
              : t.errNet}
          </p>
          {loadErr !== "role" && (
            <button
              onClick={load}
              className="mt-2 rounded-lg border-2 border-amber-600 px-4 py-2 min-h-11 font-semibold text-amber-900 active:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1"
            >
              {t.retry}
            </button>
          )}
        </div>
      )}

      {/* ---- Running stoppages: the STOP half. Always first — a machine that is
           down is the most urgent thing on the page. A stoppage from a previous
           day stays HERE, still counting, with the same measured stop — it is
           not moved to a "forgotten" pile (owner's rule, 2026-08-20). ---- */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-500 mb-2">{t.running}</h2>
        {openList.length === 0 ? (
          <EmptyState text={t.noneRunning} />
        ) : (
          <div className="space-y-3">
            {openList.map((e) => (
              <div
                key={e.id}
                className="flex items-center gap-3 rounded-2xl border-2 border-red-200 bg-red-50 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-lg font-bold text-gray-900 truncate">{e.machine}</div>
                  <div className="text-sm text-red-700">
                    {reasonLabel(e.reason)} · {t.runningSince}{" "}
                    {elapsed(e.startedAt, now, t.minutes, t.day)}
                  </div>
                  {/* Started on an earlier factory day — say so, so a long
                      stoppage reads as deliberate, not as a stuck counter. */}
                  {e.date !== data?.todayDate && (
                    <div className="text-xs text-amber-700 mt-0.5">
                      {t.staleSince} {e.date}
                    </div>
                  )}
                  {/* Logged late? Pull the start back one step per press — the
                      counter above jumps, which is the feedback. Disabled at
                      the server's cap so the floor never sees a refusal. */}
                  <button
                    onClick={() => backdate(e.id)}
                    disabled={busy || (e.backdatedMin ?? 0) + BACKDATE_STEP_MIN > BACKDATE_CAP_MIN}
                    className="mt-2 inline-flex min-h-11 items-center rounded-xl border-2 border-amber-400 bg-white px-3 py-1.5 text-sm font-semibold text-amber-800 active:bg-amber-50 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1"
                  >
                    {t.backdateHint} {t.backdate}
                  </button>
                </div>
                <button
                  onClick={() => stop(e.id)}
                  disabled={busy}
                  className={`${TAP} border-green-600 bg-green-600 text-white px-6 shrink-0`}
                >
                  {t.stop}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---- Start: machine, then reason. Two steps so each screen is one
           decision with big targets, instead of a long scrolling form. ---- */}
      <section>
        {!machine ? (
          <>
            <h2 className="text-sm font-semibold text-gray-500 mb-2">{t.pickMachine}</h2>
            {machines.length === 0 ? (
              <EmptyState text={t.machinesFailed} />
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {machines.map((m) => {
                  const down = openByMachine.has(m.label);
                  return (
                    <button
                      key={m.label}
                      onClick={() => setMachine(m.label)}
                      disabled={down}
                      className={`${TAP} ${
                        down
                          ? "border-red-200 bg-red-50 text-red-400"
                          : "border-gray-300 bg-white text-gray-900 hover:border-blue-400"
                      }`}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 mb-2">
              <h2 className="text-sm font-semibold text-gray-500">
                {t.pickReason} <span className="text-gray-900 font-bold">{machine}</span>
              </h2>
              <Btn variant="ghost" onClick={() => setMachine("")}>{t.change}</Btn>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {DOWNTIME_CAPTURE_REASONS.map((r) => (
                <button
                  key={r.key}
                  onClick={() => start(r.key)}
                  disabled={busy}
                  className={`${TAP} border-amber-400 bg-amber-50 text-gray-900 hover:bg-amber-100`}
                >
                  {isAr ? r.ar : r.en}
                </button>
              ))}
            </div>
            {busy && <p className="mt-3 text-sm text-gray-500">{t.saving}</p>}
          </>
        )}
      </section>

      {/* ---- Today's finished stoppages ---- */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold text-gray-500 mb-2">{t.today}</h2>
        {/* The sheet half failed or stalled: the remembered list stays, this
            line says so, and the retry asks for the finished list alone — the
            running stoppages and the start/stop buttons are untouched. */}
        {todayErr && (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
            <span>{todayErr === "timeout" ? p.common.timedOut : p.common.loadError}</span>
            <button
              type="button"
              onClick={() => { setTodayErr(null); void loadFull(); }}
              className="inline-flex items-center min-h-11 px-2 -mx-2 rounded-lg font-semibold underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            >
              {p.common.retry}
            </button>
          </div>
        )}
        {!todayLoaded && !todayErr && todayShown && (
          <p className="mb-2 text-xs text-gray-500">{p.common.stillLoading}</p>
        )}
        {todayList.length === 0 ? (
          todayShown ? <EmptyState text={t.empty} /> : todayErr ? null : <Spinner text={p.common.loading} />
        ) : (
          <div className="space-y-3">
            {todayList.map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900 truncate">{e.machine}</div>
                  <div className="text-sm text-gray-500">
                    {reasonLabel(e.reason)}
                    {/* An estimate must never read as a measurement. */}
                    {e.estimated && (
                      <span className="ms-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                        {t.staleEstimated}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-lg font-bold text-gray-900 shrink-0 tabular-nums">
                  {e.minutes.toLocaleString(LOCALE_AR)} <span className="text-sm font-normal text-gray-500">{t.minutes}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---- OWNER REVIEW: relabel «أخرى» rows. Renders for owner/manager
           only — the floor never sees it, so the four-tap flow is untouched.
           «أخرى» reached 25 of 54 rows including the biggest events; a Pareto
           where half the minutes are "Other" answers nothing. ---- */}
      {isBoss && others !== null && (
        <section className="mt-10">
          <h2 className="text-sm font-semibold text-gray-500 mb-1">
            {t.reclassTitle}{others.length > 0 ? ` (${others.length.toLocaleString(LOCALE_AR)})` : ""}
          </h2>
          <p className="text-sm text-gray-500 mb-3">{t.reclassBody}</p>
          {reclassErr && (
            <div className="mb-3 rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {reclassErr === "rejected" ? t.reclassRejected
                : reclassErr === "changed" ? t.reclassChanged
                : t.reclassFailed}
            </div>
          )}
          {others.length === 0 ? (
            <EmptyState text={t.reclassEmpty} />
          ) : (
            <div className="space-y-2">
              {others.map((r) => (
                <div key={r.row} className="bg-white border border-gray-200 rounded-xl px-4 py-3">
                  <button
                    onClick={() => { setReclassErr(""); setReclassRow(reclassRow === r.row ? null : r.row); }}
                    className="w-full min-h-11 flex items-center justify-between gap-3 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 rounded-lg"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-900 truncate">{r.machine}</div>
                      <div className="text-sm text-gray-500">{r.date}</div>
                    </div>
                    <div className="text-lg font-bold text-gray-900 shrink-0 tabular-nums">
                      {r.minutes.toLocaleString(LOCALE_AR)} <span className="text-sm font-normal text-gray-500">{t.minutes}</span>
                    </div>
                  </button>
                  {reclassRow === r.row && (
                    <div className="mt-3 border-t border-gray-100 pt-3">
                      <p className="text-sm font-semibold text-gray-600 mb-2">{t.reclassPick}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {DOWNTIME_CAPTURE_REASONS.filter((x) => x.key !== "Other").map((x) => (
                          <button
                            key={x.key}
                            onClick={() => reclassify(r, x.key)}
                            disabled={reclassBusy}
                            className="min-h-11 rounded-xl border-2 border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900 hover:border-blue-400 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                          >
                            {isAr ? x.ar : x.en}
                          </button>
                        ))}
                      </div>
                      {reclassBusy && <p className="mt-2 text-sm text-gray-500">{t.saving}</p>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
