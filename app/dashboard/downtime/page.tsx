"use client";
import { useCallback, useEffect, useState } from "react";
import { useLang } from "@/context/LangContext";
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
};
type Data = { open: Event[]; today: Event[]; todayDate: string };

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
  const p = pd[lang];
  const t = p.downtime;
  const isAr = lang === "ar";

  const [machines, setMachines] = useState<MachineInfo[] | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [machine, setMachine] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // Ticks once a minute so a running stoppage counts up on its own.
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const res = await authedFetch("/api/downtime");
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    fetch("/api/machines")
      .then((r) => r.json())
      .then((d) => setMachines(d.machines ?? []))
      .catch(() => setMachines([]));
    load();
  }, [load]);

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

  if (machines === null || data === null) return <Spinner text={p.common.loading} />;

  const openByMachine = new Set(data.open.map((e) => e.machine));
  const lostToday = data.today.reduce((s, e) => s + e.minutes, 0);
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
        <button onClick={exportCsv} className="text-sm text-blue-600 hover:underline">
          {t.export}
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-5">{t.subtitle}</p>

      <div className="grid grid-cols-2 gap-4 mb-6 max-w-sm">
        <Stat label={t.todayMinutes} value={lostToday} sub={t.minutes} tone={lostToday > 0 ? "amber" : undefined} />
        <Stat label={t.todayEvents} value={data.today.length} />
      </div>

      {failed && (
        <div className="mb-4 rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3 text-red-700">
          {t.failed}
        </div>
      )}

      {/* ---- Running stoppages: the STOP half. Always first — a machine that is
           down is the most urgent thing on the page. ---- */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-500 mb-2">{t.running}</h2>
        {data.open.length === 0 ? (
          <EmptyState text={t.noneRunning} />
        ) : (
          <div className="space-y-3">
            {data.open.map((e) => (
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
        {data.today.length === 0 ? (
          <EmptyState text={t.empty} />
        ) : (
          <div className="space-y-2">
            {data.today.map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900 truncate">{e.machine}</div>
                  <div className="text-sm text-gray-500">{reasonLabel(e.reason)}</div>
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
