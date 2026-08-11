"use client";
import { useCallback, useEffect, useState } from "react";
import { useLang } from "@/context/LangContext";
import { useAuth } from "@/context/AuthContext";
import { pd } from "@/lib/i18n.prod";
import { Btn, Spinner, EmptyState, Stat } from "@/components/dashboard/ui";
import { authedFetch } from "@/lib/authed-fetch";
import { DOWNTIME_CAPTURE_REASONS } from "@/lib/prod-meta";

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
};
type Data = { open: Event[]; stale: Event[]; today: Event[]; todayDate: string };

/** Big enough to hit with a work glove on. */
const TAP =
  "min-h-[64px] rounded-2xl border-2 px-4 py-3 text-lg font-semibold transition " +
  "active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100";

function elapsed(from: number, now: number): string {
  const m = Math.max(0, Math.floor((now - from) / 60000));
  return m < 60 ? `${m}` : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

export default function DowntimePage() {
  const { lang } = useLang();
  const { user, loading: authLoading } = useAuth();
  const p = pd[lang];
  const t = p.downtime;
  const isAr = lang === "ar";

  const [machines, setMachines] = useState<MachineInfo[] | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [machine, setMachine] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loadErr, setLoadErr] = useState<"auth" | "role" | "net" | null>(null);
  // Ticks once a minute so a running stoppage counts up on its own.
  const [now, setNow] = useState(() => Date.now());

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
  const load = useCallback(async () => {
    setLoadErr(null);
    try {
      const res = await authedFetch("/api/downtime");
      if (res.ok) { setData(await res.json()); return; }
      setLoadErr(res.status === 401 ? "auth" : res.status === 403 ? "role" : "net");
    } catch {
      setLoadErr("net");
    }
  }, []);

  useEffect(() => {
    fetch("/api/machines")
      .then((r) => r.json())
      .then((d) => setMachines(d.machines ?? []))
      .catch(() => setMachines([]));
  }, []);

  // Wait for Firebase to restore the session before the authenticated call.
  // authedFetch reads auth.currentUser, which is null for the first moments
  // after a page load — calling too early is an automatic 401.
  useEffect(() => {
    if (authLoading || !user) return;
    load();
  }, [authLoading, user, load]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Re-poll while something is running so a stop from another phone shows here.
  useEffect(() => {
    if (!data?.open.length) return;
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [data?.open.length, load]);

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
   * `estimate` closes a stoppage nobody stopped. It is always a deliberate tap
   * by a person — nothing here closes anything on a timer — and the row is
   * flagged `estimated` for good, capped server-side at the end of its shift.
   */
  async function stop(id: string, estimate = false) {
    if (busy) return;
    setBusy(true); setFailed(false);
    const res = await authedFetch("/api/downtime", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(estimate ? { id, estimate: true } : { id }),
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) { setFailed(true); return; }
    await load();
  }

  // Only the MACHINE LIST gates the page. If the guarded read failed we still
  // render, say why, and let the operator start a stoppage — the action that
  // matters must not be held hostage by a list that failed to load.
  if (machines === null || (data === null && loadErr === null)) {
    return <Spinner text={p.common.loading} />;
  }

  const openList = data?.open ?? [];
  const staleList = data?.stale ?? [];
  const todayList = data?.today ?? [];

  // A machine with an unclosed stoppage — running OR stale — must not be
  // startable again; that would open a second event and double-count it.
  const openByMachine = new Set([...openList, ...staleList].map((e) => e.machine));
  const lostToday = todayList.reduce((s, e) => s + e.minutes, 0);
  const reasonLabel = (key: string) => {
    const r = DOWNTIME_CAPTURE_REASONS.find((x) => x.key === key);
    return r ? (isAr ? r.ar : r.en) : key;
  };

  return (
    <div className="max-w-3xl" dir={isAr ? "rtl" : "ltr"}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <h1 className="text-2xl font-bold text-gray-900">{t.title}</h1>
        {/* Not a plain <a>: the export route is guarded by a Bearer token, which
            a browser navigation cannot attach — it would 401. Fetch it
            authenticated, then hand the blob to a throwaway link. */}
        <button onClick={exportCsv} className="inline-flex items-center min-h-11 sm:min-h-0 text-sm text-blue-600 hover:underline">
          {t.export}
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-5">{t.subtitle}</p>

      <div className="grid grid-cols-2 gap-4 mb-6 max-w-sm">
        <Stat label={t.todayMinutes} value={lostToday} sub={t.minutes} tone={lostToday > 0 ? "amber" : undefined} />
        <Stat label={t.todayEvents} value={todayList.length} />
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
            {loadErr === "auth" ? t.errAuth : loadErr === "role" ? t.errRole : t.errNet}
          </p>
          {loadErr !== "role" && (
            <button
              onClick={load}
              className="mt-2 rounded-lg border-2 border-amber-600 px-4 py-2 font-semibold text-amber-900"
            >
              {t.retry}
            </button>
          )}
        </div>
      )}

      {/* ---- Never stopped. Above everything: these carry no minutes at all, so
           they are missing from Availability until somebody closes them. ---- */}
      {staleList.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-amber-700 mb-2">
            {t.staleTitle} ({staleList.length})
          </h2>
          <p className="text-sm text-gray-600 mb-3">{t.staleBody}</p>
          <div className="space-y-3">
            {staleList.map((e) => (
              <div
                key={e.id}
                className="flex flex-wrap items-center gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-lg font-bold text-gray-900 truncate">{e.machine}</div>
                  <div className="text-sm text-amber-800">
                    {reasonLabel(e.reason)} · {t.staleSince} {e.date}
                  </div>
                </div>
                <button
                  onClick={() => stop(e.id, true)}
                  disabled={busy}
                  className={`${TAP} border-amber-600 bg-amber-600 text-white px-5 shrink-0`}
                >
                  {t.staleClose}
                </button>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-500">{t.estimatedNote}</p>
        </section>
      )}

      {/* ---- Running stoppages: the STOP half. Always first — a machine that is
           down is the most urgent thing on the page. ---- */}
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
                    {reasonLabel(e.reason)} · {t.runningSince} {elapsed(e.startedAt, now)} {t.minutes}
                  </div>
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
        {todayList.length === 0 ? (
          <EmptyState text={t.empty} />
        ) : (
          <div className="space-y-2">
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
                <div className="text-lg font-bold text-gray-900 shrink-0">
                  {e.minutes} <span className="text-sm font-normal text-gray-500">{t.minutes}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
