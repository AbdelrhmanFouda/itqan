"use client";
import { usePageTitle } from "@/components/dashboard/use-page-title";
/**
 * «أوامر الشغل» — the production manager opens, starts and closes work orders
 * here, standing on the floor with a phone (2026-09-09 brief). It replaces the
 * verbal handoff, so it has to be faster than saying it out loud:
 *
 *  - open orders first, grouped by status, soonest due date on top; an order
 *    past its date is visibly LATE, an order with no date is visibly
 *    INCOMPLETE (7 of the 10 live rows) — never hidden behind a filter;
 *  - «ابدأ التشغيل» is ONE tap: status IS the go-ahead, there is no approval
 *    step. The tap writes through the identity-checked PATCH (the row must
 *    still carry the same code on a fresh read);
 *  - a new order asks for four things only — the product (picked from
 *    «الرئيسي», never typed), the kilograms, the start date and the due date —
 *    and Master supplies the client, the mould number and, when its tonnage
 *    names one machine, the machine (2026-09-13, owner's words). The code is
 *    filled in (suggestJobCode). Nothing a person could mistype is asked, so
 *    the cards and the form carry no "fix this" messages.
 *
 * Progress still fills from production rows matching the product name on/
 * after the start date (lib/jobs.ts). The rules the list draws — open, late,
 * grouping, the one-tap transitions — are lib/work-orders.ts, unit-tested.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLang } from "@/context/LangContext";
import { pd } from "@/lib/i18n.prod";
import { Check, ChevronDown, ChevronRight, Pause, Play, Plus, RefreshCw, Search, X } from "lucide-react";
import { Pill, Field, inputCls, Btn, Modal, EmptyState, Spinner, LoadError, StatTile, iconBtnCls } from "@/components/dashboard/ui";
import { JOB_STATUSES, JOB_PRIORITIES, jobTone, priorityTone, localize, options } from "@/lib/prod-meta";
import { authedFetch } from "@/lib/authed-fetch";
import { ageLabel, fill, numLocale } from "@/lib/format";
import { timedJson } from "@/components/dashboard/last-seen";
import { useRemembered } from "@/components/dashboard/use-remembered";
import { matchesTerms, searchTerms } from "@/lib/storage-filter";
import { todayIso } from "@/lib/dates";
import {
  codeKey, daysLate, groupOrders, isLate, nextActions, statusAfter, suggestJobCode, type OrderAction,
} from "@/lib/work-orders";
import { MasterProductPicker, pieceGrams, type MasterPick } from "@/components/dashboard/master-product-picker";

type Job = {
  id: string; code: string; client: string; product: string; moldCode: string;
  // qtyOrdered is PIECES (converted from kg via Master's piece weight, in
  // lib/jobs.ts). 0 means Master has no weight for this product.
  qtyOrdered: number; qtyOrderedKg: number; startDate: string; dueDate: string;
  status: string; priority: string; machine: string;
  materialIssued: string; masterbatch: string; instructions: string; notes: string;
  produced: number; scrapped: number; remaining: number;
  linked: boolean; ambiguous: boolean; pieceWeightG: number; cavities: number; cycleSec: number;
  material: string; estHours: number;
  masterMoldNumber: string; masterMoldNotesNumber: string;
  qtyUnreadable: boolean; qtyRaw: string; materialIssuedUnreadable: boolean;
  machineMatched: boolean; codeDuplicate: boolean; open: boolean;
  masterClient: string; lastMachine: string;
};
type Duplicate = { key: string; code: string; ids: string[] };
type Data = {
  jobs: Job[]; writable: boolean; configured: boolean; duplicates: Duplicate[];
  /** Age of the sheet copy behind the numbers; absent on a device snapshot. */
  meta?: { dataAgeMs: number };
};
const LAST_KEY = "itqan.jobs.last";
/** Past this the page says «الأرقام من قبل …» and refetches once on its own. */
const STALE_AFTER_MS = 60_000;
type Tile = "" | "running" | "notStarted" | "late";
const isRunning = (j: { status: string }) => j.status === "In Production";
const isNotStarted = (j: { status: string; open: boolean }) => j.open && (!j.status || j.status === "Not Started");

/** The new-order form: product, kilograms and the two dates; the rest is optional. */
const blank = { qtyOrdered: "", startDate: "", dueDate: "", code: "", priority: "Normal", instructions: "" };

export default function JobsPage() {
  const { lang } = useLang();
  const p = pd[lang];
  const isAr = lang === "ar";
  usePageTitle(p.jobs.title);
  const today = todayIso();
  const fmt = useCallback((n: number) => Number(n || 0).toLocaleString(numLocale(isAr), { maximumFractionDigits: 2 }), [isAr]);

  const [master, setMaster] = useState<MasterPick[]>([]);
  const [masterLoaded, setMasterLoaded] = useState(false);
  const [masterFailed, setMasterFailed] = useState(false);
  // list state
  const [tile, setTile] = useState<Tile>("");
  const [search, setSearch] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [acting, setActing] = useState<string>("");
  const [actErr, setActErr] = useState("");
  // new-order modal
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...blank });
  const [picked, setPicked] = useState<MasterPick | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [codeTouched, setCodeTouched] = useState(false);
  const [attemptCode, setAttemptCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");

  const loadRef = useRef<() => Promise<void>>(async () => {});
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const staleRefetches = useRef(0);
  // Master, which feeds the new-order form, is asked for AFTER the order book
  // answers: fired first, its tab read sat ahead of «أوامر العمل» in the
  // instance's one serial bridge queue and delayed the list (2026-09-10 audit).
  const listsStarted = useRef(false);
  const loadLists = useCallback(() => {
    if (listsStarted.current) return;
    listsStarted.current = true;
    authedFetch("/api/molds")
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((m) => { setMaster(Array.isArray(m.molds) ? m.molds : []); setMasterFailed(false); })
      // A failed read is not final: the picker says so with a retry, and the
      // next «أمر جديد» asks again.
      .catch(() => { setMasterFailed(true); listsStarted.current = false; })
      .finally(() => setMasterLoaded(true));
  }, []);
  // Snapshot → paint → bounded read → keep what is on screen when it fails.
  // A non-2xx (401 on a missing/expired token) must land in the FAILED state —
  // parsed as data it flows into `configured: undefined` and the page tells the
  // user to go add a «أوامر العمل» tab, which is a lie about what went wrong.
  const { data, setData, loading, failed: error, reload: load } = useRemembered<Data>({
    key: LAST_KEY,
    read: () => timedJson<Data>(authedFetch, "/api/jobs"),
    valid: (snap) => Array.isArray(snap?.jobs),
    // A snapshot carries no server-side age — the spinner is its honest hint.
    hydrate: (snap) => ({ ...snap, meta: undefined }),
    onLoaded: (json) => {
      // The server served a copy older than a minute and has already begun
      // refreshing it in the background (lib/sheets.ts): ask once more in a
      // few seconds so the page catches up without anyone pressing anything.
      // Bounded, so a bridge that stays down does not turn this into a poll.
      const age = json.meta?.dataAgeMs ?? 0;
      if (age <= STALE_AFTER_MS) staleRefetches.current = 0;
      else if (!refetchTimer.current && staleRefetches.current < 2) {
        staleRefetches.current += 1;
        refetchTimer.current = setTimeout(() => { refetchTimer.current = null; loadRef.current(); }, 8000);
      }
    },
    onSettled: loadLists,
  });
  loadRef.current = load;
  useEffect(() => () => { if (refetchTimer.current) clearTimeout(refetchTimer.current); }, []);

  /* ------------------------------- the list -------------------------------- */

  const jobs = useMemo(() => data?.jobs ?? [], [data]);
  const counts = useMemo(() => ({
    open: jobs.filter((j) => j.open).length,
    running: jobs.filter(isRunning).length,
    notStarted: jobs.filter(isNotStarted).length,
    late: jobs.filter((j) => isLate(j, today)).length,
    done: jobs.filter((j) => !j.open).length,
  }), [jobs, today]);
  const terms = useMemo(() => searchTerms(search), [search]);
  const shown = useMemo(() => {
    let list = jobs;
    if (tile === "running") list = list.filter(isRunning);
    if (tile === "notStarted") list = list.filter(isNotStarted);
    if (tile === "late") list = list.filter((j) => isLate(j, today));
    if (terms.length) {
      list = list.filter((j) => matchesTerms([j.code, j.masterClient, j.client, j.product, j.machine, j.lastMachine, j.masterMoldNumber, j.instructions], terms));
    }
    return list;
  }, [jobs, tile, terms, today]);
  const groups = useMemo(() => groupOrders(shown), [shown]);
  const filtered = !!(tile || terms.length);

  /* ------------------------------ one-tap acts ----------------------------- */

  async function act(job: Job, action: OrderAction) {
    if (acting) return;
    setActing(job.id);
    setActErr("");
    const status = statusAfter(action);
    // Optimistic: the pill flips at once; a failure reloads the truth.
    setData((d) => d ? { ...d, jobs: d.jobs.map((j) => (j.id === job.id ? { ...j, status } : j)) } : d);
    // The row check compares the code; an order with none goes unchecked
    // rather than failing every tap with «row_changed».
    const body: Record<string, unknown> = codeKey(job.code) ? { status, expect: { code: job.code } } : { status };
    // Starting an order that never had a start date dates it today, so its
    // progress counts production from now on (the sheet's «تاريخ البدء»).
    if (action === "start" && !job.startDate) body.startDate = today;
    // Bounded (2026-09-10): a save that hangs must not hold the button forever —
    // the bridge is at-least-once, so a timed-out save may still have landed,
    // which is why the list is reloaded before anyone taps again.
    const res = await authedFetch(`/api/jobs/${job.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    }).catch(() => null);
    if (!res || !res.ok) {
      const reason = res ? String((await res.json().catch(() => ({}))).reason ?? "") : "";
      setActErr((p.jobs.errors as Record<string, string>)[reason] ?? p.jobs.actionFailed);
      // A failed-looking save may still have landed (at-least-once bridge):
      // the list is reloaded BEFORE the buttons come back, so nobody taps twice.
      await load();
      setActing("");
      return;
    }
    // Confirmed: the optimistic pill already shows what the sheet holds. The
    // buttons come back now; the reload runs behind (2026-09-10 — waiting for
    // it froze every button on every card for a whole bridge round trip).
    setActing("");
    load();
  }

  /* ------------------------------ the new order ---------------------------- */

  // Master supplies everything about the product; the person gives the
  // kilograms and the two dates. Save stays disabled until those are there,
  // and the grey line under the form says what is still missing.
  const kgTyped = Number(form.qtyOrdered) || 0;
  const grams = picked ? pieceGrams(picked.weight) : 0;
  const piecesPreview = grams > 0 && kgTyped > 0 ? Math.round((kgTyped * 1000) / grams) : 0;
  // The code is filled in from the list until the person types one. The first
  // save attempt pins it (attemptCode), so a retry after an answer that looked
  // failed sends the SAME code and the server recognises its own order.
  const autoCode = useMemo(() => suggestJobCode(jobs.map((j) => j.code)), [jobs]);
  const typedCode = codeTouched && !!codeKey(form.code);
  const shownCode = codeTouched ? form.code : attemptCode || autoCode;
  const codeTaken = typedCode && jobs.some((j) => codeKey(j.code) === codeKey(form.code));
  const datesBad = !!form.startDate && !!form.dueDate && form.dueDate < form.startDate;
  const canSave = !!picked && kgTyped > 0 && !!form.dueDate && !datesBad && !codeTaken && !saving;
  const hint = codeTaken ? p.jobs.codeTaken : datesBad ? p.jobs.dueBeforeStart : p.jobs.pickProductFirst;
  const moreOpen = showMore || codeTaken;

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
    if (k === "code") setCodeTouched(true);
  }

  function openNew() {
    setForm({ ...blank, startDate: today });
    setPicked(null);
    setShowMore(false);
    setCodeTouched(false);
    setAttemptCode("");
    setSaveErr("");
    setOpen(true);
    // Master may have failed to load earlier — ask again now that it is needed.
    if (master.length === 0) loadLists();
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave || !picked) return;
    const code = typedCode ? form.code.trim() : attemptCode || autoCode;
    if (!typedCode) setAttemptCode(code);
    setSaveErr("");
    setSaving(true);
    const res = await authedFetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product: picked.name, masterRow: picked.row, qtyOrdered: form.qtyOrdered,
        startDate: form.startDate || today, dueDate: form.dueDate,
        code, codeAuto: !typedCode, priority: form.priority, instructions: form.instructions, status: "Not Started",
      }),
      signal: AbortSignal.timeout(90_000),
    }).catch(() => null);
    setSaving(false);
    if (!res || !res.ok) {
      const reason = res ? String((await res.json().catch(() => ({}))).reason ?? "") : "";
      // The bridge is at-least-once: whatever the answer, the list is read
      // again, and the message never claims that nothing was written. A retry
      // is safe — it re-sends the pinned code.
      setSaveErr((p.jobs.errors as Record<string, string>)[reason] ?? p.jobs.saveNotDone);
      if (reason === "duplicate_code") setShowMore(true);
      load();
      return;
    }
    setOpen(false);
    load();
  }

  /* --------------------------------- states -------------------------------- */

  const jobsTabMissing = isAr
    ? "تبويب «أوامر العمل» غير موجود في جدول البيانات. أضِفه بعناوينه في الصف الأول، ثم أعد التحميل."
    : "The sheet has no «أوامر العمل» tab yet. Add it with its headers in row 1, then reload.";

  if (error && !data) {
    return (
      <div className="max-w-5xl" dir={isAr ? "rtl" : "ltr"}>
        <h1 className="text-2xl font-bold text-gray-900 mb-4">{p.jobs.title}</h1>
        <LoadError
          variant="empty"
          text={error.timedOut ? p.common.timedOut : p.common.loadError}
          retry={p.common.retry}
          onRetry={load}
          loading={loading}
        />
      </div>
    );
  }
  if (!data) return <div className="flex justify-center py-16"><Spinner text={p.common.loading} /></div>;
  const dataAge = data.meta?.dataAgeMs ?? 0;

  return (
    <div className="max-w-5xl" dir={isAr ? "rtl" : "ltr"}>
      <div className="mb-5 sm:mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-gray-900">{p.jobs.title}</h1>
          <div className="flex items-center gap-1.5">
            <button onClick={load} className={iconBtnCls} title={p.common.loading} aria-label={p.common.refresh} disabled={loading}>
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            </button>
            {data.writable && data.configured && (
              <Btn onClick={openNew} className="min-h-12 sm:min-h-10 px-5 text-base sm:text-sm rounded-xl"><Plus size={16} /> {p.jobs.add}</Btn>
            )}
          </div>
        </div>
        <p className="text-sm text-gray-500 mt-1">{p.jobs.subtitle} · {p.jobs.listedBy}</p>
        {/* A snapshot is showing and the live read failed: say so, keep the snapshot. */}
        {error && (
          <LoadError
            className="mt-2"
            text={error.timedOut ? p.common.timedOut : p.common.loadError}
            retry={p.common.retry}
            onRetry={load}
            loading={loading}
          />
        )}
        {dataAge > STALE_AFTER_MS && (
          <p className="text-xs text-amber-700 mt-2">{fill(p.jobs.dataAge, { age: ageLabel(dataAge, isAr) })}</p>
        )}
      </div>

      {!data.configured ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 sm:p-5">
          <p className="text-sm font-medium text-amber-900">{jobsTabMissing}</p>
        </div>
      ) : (
        <>
          {/* tiles — each one filters */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-1">
            <StatTile label={p.jobs.tilesOpen} value={String(counts.open)} active={tile === ""} onClick={() => setTile("")} />
            <StatTile label={p.jobs.tilesInProduction} value={String(counts.running)} active={tile === "running"} onClick={() => setTile(tile === "running" ? "" : "running")} />
            <StatTile label={p.jobs.tilesNotStarted} value={String(counts.notStarted)} active={tile === "notStarted"} onClick={() => setTile(tile === "notStarted" ? "" : "notStarted")} />
            <StatTile label={p.jobs.tilesLate} value={String(counts.late)} tone={counts.late ? "red" : undefined} active={tile === "late"} onClick={() => setTile(tile === "late" ? "" : "late")} />
          </div>
          <p className="text-[11px] text-gray-400 mb-3">{p.jobs.tilesHint}</p>
          {actErr && <p className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mb-3">{actErr}</p>}

          {/* search */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <label className="relative flex-1 min-w-[14rem]">
              <Search size={15} className="absolute top-1/2 -translate-y-1/2 start-3 text-gray-400 pointer-events-none" />
              <input
                className="w-full border border-gray-300 rounded-lg ps-9 pe-9 py-2 min-h-11 sm:min-h-0 text-base sm:text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                placeholder={p.common.search}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label={p.common.search}
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute top-1/2 -translate-y-1/2 end-2 min-w-8 min-h-8 inline-flex items-center justify-center text-gray-400 hover:text-gray-700 rounded" aria-label={p.common.cancel}>
                  <X size={14} />
                </button>
              )}
            </label>
            {filtered && (
              <button onClick={() => { setTile(""); setSearch(""); }} className={iconBtnCls}><X size={14} /> {p.common.all}</button>
            )}
          </div>

          {jobs.length === 0 ? (
            <EmptyState text={p.jobs.empty} />
          ) : shown.length === 0 ? (
            <EmptyState text={p.jobs.empty} />
          ) : (
            <div className="space-y-6">
              {groups.filter((g) => g.open).map((g) => (
                <Group key={g.status} title={groupTitle(g.status, p)} count={g.jobs.length} tone={jobTone(g.status)}>
                  {g.jobs.map((j) => (
                    <OrderCard key={j.id} j={j} p={p} isAr={isAr} today={today} fmt={fmt} acting={acting === j.id} busy={!!acting} onAct={(a) => act(j, a)} />
                  ))}
                </Group>
              ))}
              {counts.done > 0 && !filtered && (
                <button
                  onClick={() => setShowDone((v) => !v)}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2 min-h-11 rounded-lg border border-gray-300 text-sm text-gray-700 bg-white hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                  aria-expanded={showDone}
                >
                  {showDone ? p.jobs.hideDone : fill(p.jobs.showDone, { n: counts.done })}
                </button>
              )}
              {(showDone || filtered) && groups.filter((g) => !g.open).map((g) => (
                <Group key={g.status} title={groupTitle(g.status, p)} count={g.jobs.length} tone={jobTone(g.status)}>
                  {g.jobs.map((j) => (
                    <OrderCard key={j.id} j={j} p={p} isAr={isAr} today={today} fmt={fmt} acting={acting === j.id} busy={!!acting} onAct={(a) => act(j, a)} />
                  ))}
                </Group>
              ))}
            </div>
          )}
        </>
      )}

      <Modal open={open} title={p.jobs.add} onClose={() => setOpen(false)} isAr={isAr}>
        {/* noValidate: the browser's own bubbles («Value must be…», often in English)
            are exactly the errors this form must not show. */}
        <form onSubmit={handleAdd} noValidate>
          {/* Not a <Field>: that is a <label>, and a label wrapping a search box
              and a list of buttons sends every tap to the first control. */}
          <div className="mb-3">
            <span className="block text-xs font-medium text-gray-600 mb-1">{p.jobs.part}</span>
            <MasterProductPicker rows={master} value={picked} onChange={setPicked} loading={!masterLoaded} failed={masterFailed} onRetry={loadLists} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4">
            {/* The sheet column is «الكمية المطلوبة (كجم)» — label the unit so
                nobody types a piece count into a kilogram field. */}
            <Field label={p.jobs.qtyOrderedKg}>
              <input className={inputCls} type="number" inputMode="decimal" min="0" step="any" value={form.qtyOrdered} onChange={(e) => set("qtyOrdered", e.target.value)} />
              {piecesPreview > 0 && (
                <span className="block text-[11px] text-gray-500 mt-1 tabular-nums">{fill(p.jobs.piecesFromMaster, { pcs: fmt(piecesPreview), g: grams })}</span>
              )}
            </Field>
            <Field label={p.jobs.startDate}>
              <input className={inputCls} type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />
            </Field>
            <Field label={p.jobs.due}>
              <input className={inputCls} type="date" value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
            </Field>
          </div>
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            aria-expanded={moreOpen}
            className="inline-flex items-center gap-1.5 min-h-11 sm:min-h-9 px-1 mb-2 rounded-lg text-sm text-gray-600 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          >
            <ChevronDown size={15} className={`transition-transform ${moreOpen ? "rotate-180" : ""}`} /> {p.jobs.moreDetails}
          </button>
          {moreOpen && (
            <>
              <div className="grid sm:grid-cols-2 gap-x-4">
                <Field label={p.jobs.codeAuto}>
                  <input className={inputCls} value={shownCode} onChange={(e) => set("code", e.target.value)} autoComplete="off" />
                </Field>
                <Field label={p.jobs.priority}>
                  <select className={inputCls} value={form.priority} onChange={(e) => set("priority", e.target.value)}>
                    {options(JOB_PRIORITIES, p.jobs.priorities).map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label={p.jobs.instructions}>
                <textarea className={`${inputCls} resize-none`} rows={2} value={form.instructions} onChange={(e) => set("instructions", e.target.value)} />
              </Field>
            </>
          )}
          {saveErr && <p className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mb-2">{saveErr}</p>}
          {!canSave && !saving && <p className="text-xs text-gray-500 mb-2">{hint}</p>}
          <div className="flex flex-wrap items-center gap-3 mt-2">
            <Btn type="submit" disabled={!canSave} className="flex-1 sm:flex-none min-h-12 sm:min-h-10">{saving ? p.common.loading : p.common.save}</Btn>
            <Btn type="button" variant="outline" onClick={() => setOpen(false)}>{p.common.cancel}</Btn>
          </div>
        </form>
      </Modal>
    </div>
  );
}

/* --------------------------------- pieces --------------------------------- */

type P = (typeof pd)["en"] | (typeof pd)["ar"];

function groupTitle(status: string, p: P): string {
  const i = JOB_STATUSES.indexOf(status);
  return i >= 0 ? p.jobs.statuses[i] : status === "Delivered" ? p.jobs.statuses[3] : `${p.jobs.unknownStatusGroup}: ${status}`;
}

function Group({ title, count, tone, children }: { title: string; count: number; tone: "green" | "amber" | "red" | "gray" | "blue"; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <Pill text={title} tone={tone} />
        <span className="text-xs text-gray-400 tabular-nums">{count}</span>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function OrderCard({ j, p, isAr, today, fmt, acting, busy, onAct }: {
  j: Job; p: P; isAr: boolean; today: string; fmt: (n: number) => string;
  acting: boolean; busy: boolean; onAct: (a: OrderAction) => void;
}) {
  const pct = j.qtyOrdered ? Math.min(100, (j.produced / j.qtyOrdered) * 100) : 0;
  const late = isLate(j, today);
  const days = j.dueDate ? daysLate(j.dueDate, today) : 0;
  // What the sheet and Master say about the order, never a complaint about
  // them (2026-09-13): the machine is the order's own cell when it is a
  // registry label, else the machine it last ran on.
  const machine = j.machineMatched ? j.machine : j.lastMachine;
  const qtyLine = j.qtyOrdered > 0
    ? `${fmt(j.qtyOrderedKg)} ${p.jobs.kg} × ${j.pieceWeightG} ${p.jobs.gPerPc} = ${fmt(j.qtyOrdered)} ${p.jobs.pcs}`
    : j.qtyOrderedKg > 0 ? `${fmt(j.qtyOrderedKg)} ${p.jobs.kg}` : "";
  // The date is isolated when drawn: an ISO date inside an Arabic line reads
  // backwards («26-09-2026»). Only the tail after it is text.
  const dueLine = !j.dueDate
      ? null
      : late
        ? { tail: ` · ${fill(p.jobs.lateBy, { n: days })}`, cls: "text-red-600 font-medium" }
        : days === 0
          ? { tail: ` · ${p.jobs.dueToday}`, cls: "text-amber-700 font-medium" }
          : { tail: j.open ? ` · ${fill(p.jobs.dueIn, { n: -days })}` : "", cls: "text-gray-500" };
  const actions = nextActions(j.status);
  const actionBtn = (a: OrderAction) => {
    const base = "inline-flex items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 min-h-11 sm:min-h-9 px-4";
    if (a === "start" || a === "resume") {
      return (
        <button key={a} type="button" disabled={busy} onClick={() => onAct(a)} title={p.jobs.startHint}
          className={`${base} flex-1 sm:flex-none bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white shadow-sm focus-visible:ring-blue-500/40`}>
          <Play size={15} /> {a === "start" ? p.jobs.start : p.jobs.resume}
        </button>
      );
    }
    if (a === "complete") {
      return (
        <button key={a} type="button" disabled={busy} onClick={() => onAct(a)}
          className={`${base} flex-1 sm:flex-none border border-emerald-300 text-emerald-700 bg-white hover:bg-emerald-50 active:bg-emerald-100 focus-visible:ring-emerald-500/40`}>
          <Check size={15} /> {p.jobs.complete}
        </button>
      );
    }
    return (
      <button key={a} type="button" disabled={busy} onClick={() => onAct(a)}
        className={`${base} border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 active:bg-gray-100 focus-visible:ring-blue-500/40`}>
        <Pause size={15} /> {p.jobs.hold}
      </button>
    );
  };

  return (
    <div className={`bg-white border rounded-xl p-4 sm:p-5 ${late ? "border-red-200" : "border-gray-200"} ${acting ? "opacity-70" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* flex-wrap: code + pills don't fit one phone line; wrapping beats
              squeezing the pills off the card. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={`/dashboard/jobs/${j.id}`} className="font-semibold text-gray-900 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 rounded">
              {j.code || "—"}
            </Link>
            <Pill text={localize(j.status, JOB_STATUSES, p.jobs.statuses)} tone={jobTone(j.status)} />
            <Pill text={localize(j.priority, JOB_PRIORITIES, p.jobs.priorities)} tone={priorityTone(j.priority)} />
          </div>
          <p className="text-sm text-gray-700 mt-1.5">
            {[j.ambiguous ? j.client || j.masterClient : j.masterClient || j.client, j.product && j.masterMoldNumber ? `${j.product} (${p.jobs.moldNumber} ${j.masterMoldNumber})` : j.product].filter(Boolean).join(" · ") || "—"}
          </p>
          {machine && <p className="text-xs text-gray-500 mt-0.5">{p.jobs.machine}: <bdi dir="ltr">{machine}</bdi></p>}
          {/* Shows the kg→pieces working, so the number is never a black box. */}
          {qtyLine && <p className="text-[11px] text-gray-400 mt-0.5 tabular-nums">{qtyLine}</p>}
          {dueLine && <p className={`text-xs mt-1 ${dueLine.cls}`}>{p.jobs.due}: <bdi dir="ltr">{j.dueDate}</bdi>{dueLine.tail}</p>}
        </div>
        <Link href={`/dashboard/jobs/${j.id}`} className="shrink-0 min-w-11 min-h-11 -me-2 inline-flex items-center justify-center text-gray-300 hover:text-gray-600 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40" aria-label={p.jobs.detail}>
          <ChevronRight size={18} className={isAr ? "-scale-x-100" : ""} />
        </Link>
      </div>
      <div className="flex items-center gap-3 mt-3">
        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden" dir="ltr">
          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs text-gray-500 whitespace-nowrap tabular-nums" dir="ltr">
          {j.qtyOrdered > 0 ? `${fmt(j.produced)} / ${fmt(j.qtyOrdered)} ${p.jobs.pcs}` : `${fmt(j.produced)} ${p.jobs.pcs}`}
        </span>
      </div>
      {actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {actions.map(actionBtn)}
        </div>
      )}
    </div>
  );
}

/** A number that is also a filter. */
