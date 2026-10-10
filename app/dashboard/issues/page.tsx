"use client";
import { uniqueByLabel } from "@/lib/run-row";
/**
 * The issues log («الأعطال») — rebuilt 2026-09-09 around the worker's VOICE.
 *
 * What changed and why:
 *  - Logging a fault used to mean typing Arabic into a form on a phone at the
 *    press. Now the big red button records it (lib/issues.ts, the recorder in
 *    components/dashboard/audio-recorder.tsx); text is optional when there is
 *    a recording. The solution can be recorded the same way — at the time, or
 *    later from the opened issue.
 *  - Every issue OPENS (tap the card / row): the recordings play there, the
 *    solution is added there, the status is changed there, and any field can
 *    be corrected. The status pill on the list still advances with one tap.
 *  - The three tiles filter, and there are mould, machine and category filters
 *    next to the search — the open faults on one mould is what maintenance
 *    actually asks for.
 *  - MOULD-FIRST since 2026-10-07 (owner: "the problem is with the mold more
 *    than machine"): the product is picked from «الرئيسي», titles the cards
 *    and rows (with its mould number), and the opened issue shows Master's
 *    «ملاحظات» for it with ONE previewed write — components/dashboard/
 *    issue-master-notes.tsx. The machine is optional unless the category is
 *    a machine one.
 *
 * Every write goes through PATCH /api/issues/[row] with the row's identity
 * (`expect`) — a 409 means the row moved under us; the list reloads and the
 * tap is asked for again. The recording columns and the microphone appear
 * only once the deployed bridge reports the `audio` feature; until then the
 * page is text-only and says why.
 */
import { usePageTitle } from "@/components/dashboard/use-page-title";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLang } from "@/context/LangContext";
import { useAuth } from "@/context/AuthContext";
import { pd } from "@/lib/i18n.prod";
import { ak } from "@/lib/i18n.ask";
import { ASK_ISSUE_KEY, canAsk, type IssueSnap } from "@/lib/ask";
import { Plus, Pencil, Mic, ChevronDown, ChevronUp, X, MessageCircleQuestionMark } from "lucide-react";
import { Field, inputCls, Btn, Modal, Spinner, EmptyState, LoadError, StatTile, type TileTone } from "@/components/dashboard/ui";
import { authedFetch } from "@/lib/authed-fetch";
import { readLastSeen, writeLastSeen, timedJson } from "@/components/dashboard/last-seen";
import { useVisiblePoll } from "@/components/dashboard/use-remembered";
import { fmtNum, fill } from "@/lib/format";
import { formatDate } from "@/lib/dates";
import {
  CATEGORY_ORDER, DEFAULT_CATEGORY, ISSUE_STATUSES, NEXT_STATUS, MAX_REQUEST_BYTES,
  cairoToday, countByStatus, dayLabel, diffIssue, extFor, hasProblem, isMachineCategory, matchesIssue, productKey,
  type AudioRef, type IssueStatus,
} from "@/lib/issues";
import { AudioField, SavedClip, useAudioRecorder, type Recording } from "@/components/dashboard/audio-recorder";
import { MasterProductPicker, findProduct, type MasterPick } from "@/components/dashboard/master-product-picker";
import { IssueMasterNotes, type MasterRow } from "@/components/dashboard/issue-master-notes";

type Issue = {
  row: number; date: string; machine: string; product: string; category: string;
  description: string; action: string; status: string; note: string;
  issueAudio: AudioRef | null; solutionAudio: AudioRef | null;
};
type Machine = { label: string; status: string };
type Strings = (typeof pd)["en"]["issues"];
type Common = (typeof pd)["en"]["common"];
type Files = { issue?: Recording; solution?: Recording };
type Draft = {
  date: string; machine: string; product: string; category: string;
  description: string; action: string; status: string; note: string;
};
/** The whole `/api/issues` answer — what the device remembers between visits. */
type IssuesResp = { issues?: Issue[]; audio?: { supported?: boolean } };

/**
 * The last answer this device saw. «الأعطال» is a sheet read, and a sheet read
 * on a cold serverless instance has been measured at 10–160s — the page used
 * to show a spinner for all of it. Now it shows what it showed last time and
 * replaces it when the live answer lands (components/dashboard/last-seen.ts).
 */
const LAST_KEY = "itqan.issues.last";

const statusCls = (s: string) =>
  s === "تم"
    ? "border-green-200 bg-green-50 text-green-700"
    : s === "قيد التنفيذ"
    ? "border-amber-300 bg-amber-50 text-amber-700"
    : "border-red-200 bg-red-50 text-red-700";
const statusTone = (s: string): TileTone => (s === "تم" ? "green" : s === "قيد التنفيذ" ? "amber" : "red");

const CHIP =
  "inline-flex items-center min-h-11 sm:min-h-9 rounded-full border px-3.5 text-sm font-medium whitespace-nowrap transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40";
const chipCls = (on: boolean) =>
  `${CHIP} ${on ? "border-blue-600 bg-blue-600 text-white" : "border-gray-300 bg-white text-gray-700 hover:border-blue-400"}`;

/** Bytes of the recordings a save would carry — refused client-side before a
 *  413 could. */
const filesBytes = (f: Files) => (f.issue?.blob.size ?? 0) + (f.solution?.blob.size ?? 0);

/** The row as the client sees it — sent with every write, checked server-side. */
const identity = (i: Issue) => ({
  date: i.date, machine: i.machine, product: i.product, description: i.description,
  issueAudio: i.issueAudio?.id ?? "",
});

export default function IssuesPage() {
  const { lang } = useLang();
  const { user, profile, loading: authLoading } = useAuth();
  const router = useRouter();
  // «اسأل Claude» — owner, manager and maintenance only (lib/ask.ts canAsk; the
  // API checks the same list). Everyone else sees this page exactly as before.
  const mayAsk = canAsk(profile?.role);
  const askT = ak[lang];
  /** The issue just logged, offered to Claude until dismissed. */
  const [askOffer, setAskOffer] = useState<Draft | null>(null);
  const p = pd[lang];
  const t = p.issues;
  const isAr = lang === "ar";
  usePageTitle(t.title);

  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [audioOk, setAudioOk] = useState(false);
  const [machines, setMachines] = useState<Machine[]>([]);
  // «الرئيسي» for the product picker and the mould numbers — null until it
  // answers; a failed read shows a retry in the picker and asks again.
  const [master, setMaster] = useState<MasterRow[] | null>(null);
  const [masterFailed, setMasterFailed] = useState(false);
  const masterStarted = useRef(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [machineFilter, setMachineFilter] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // A read that failed or timed out — the list on screen is KEPT and this line
  // says so; it never blanks the page and never becomes an empty list.
  const [loadErr, setLoadErr] = useState<"net" | "timeout" | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);
  const noticeTimer = useRef<number | null>(null);
  const today = cairoToday();

  const notify = useCallback((kind: "ok" | "err", text: string) => {
    setNotice({ kind, text });
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), kind === "ok" ? 4000 : 8000);
  }, []);

  /**
   * The list. BOUNDED (timedJson — the platform used to kill the function at
   * 300s while this page span) and NON-DESTRUCTIVE: a failed or timed-out read
   * keeps whatever is already on screen and raises a line with a retry, because
   * an empty list here reads as "no faults today", which would be a lie.
   */
  const load = useCallback(async () => {
    inFlight.current = true;
    setRefreshing(true);
    const r = await timedJson<IssuesResp>(authedFetch, "/api/issues");
    inFlight.current = false;
    setRefreshing(false);
    if (r.ok && Array.isArray(r.data.issues)) {
      setIssues(r.data.issues);
      setAudioOk(Boolean(r.data.audio?.supported));
      setLoadErr(null);
      writeLastSeen(LAST_KEY, r.data);
      return;
    }
    setLoadErr(!r.ok && r.timedOut ? "timeout" : "net");
  }, []);

  const loadMaster = useCallback(() => {
    if (masterStarted.current) return;
    masterStarted.current = true;
    setMasterFailed(false);
    void timedJson<{ molds?: MasterRow[] }>(authedFetch, "/api/molds").then((r) => {
      if (r.ok && Array.isArray(r.data.molds)) { setMaster(r.data.molds); setMasterFailed(false); return; }
      // Not final: the picker shows a retry, and the next open asks again.
      setMasterFailed(true);
      masterStarted.current = false;
    });
  }, []);
  // Master is read once per page life; the server saying a row moved
  // (identity_mismatch / not_found on a write) is the one reason to read again.
  const reloadMaster = useCallback(() => { masterStarted.current = false; loadMaster(); }, [loadMaster]);

  useEffect(() => {
    let alive = true;
    // Deferred a tick: the first list read sets state, and an effect body that
    // calls setState synchronously is what the compiler's lint forbids.
    void Promise.resolve()
      .then(() => {
        if (!alive) return;
        // What this device saw last time, at once — the live answer replaces it.
        const snap = readLastSeen<IssuesResp>(LAST_KEY);
        if (snap && Array.isArray(snap.issues)) {
          setIssues(snap.issues);
          setAudioOk(Boolean(snap.audio?.supported));
        }
        return load();
      })
      .then(() => {
        if (!alive) return;
        // ONLY after the log has answered. Both of these are sheet reads that
        // the bridge serialises, and they feed nothing but the form's machine
        // dropdown and the product picker — started first, they queued the tab
        // the page is actually waiting for behind them.
        // Both carry the token: the registry and Master are guarded reads (a
        // product name comes paired with a real client name in «الرئيسي»).
        void timedJson<{ machines?: Machine[] }>(authedFetch, "/api/machines")
          .then((r) => { if (alive && r.ok) setMachines(uniqueByLabel(r.data.machines ?? [])); });
        loadMaster();
      });
    return () => { alive = false; };
  }, [load, loadMaster]);
  const modalOpen = adding || openRow !== null;
  // Skip a tick while a read is still in flight — a slow sheet must not stack
  // polls on top of each other. Hidden tabs do not poll at all.
  useVisiblePoll(() => { if (!modalOpen && !inFlight.current) load(); }, 30000);

  const errorText = useCallback((reason: string) =>
    reason === "row_changed" ? t.rowChanged
    : reason === "audio_unsupported" ? t.audioNeedsBridge
    // The bridge is deployed but Drive has not been authorized yet (seen
    // 2026-09-09 on the very first save) — a different action for the owner.
    : reason === "drive_error" ? t.audioDriveError
    : reason === "audio_too_large" ? t.audioTooLong
    : reason === "description_required" ? t.descRequired
    : t.saveFailed, [t]);

  /** One PATCH with the row's identity — the pill, the drawer's status bar and the edit form all use it. */
  async function patchIssue(issue: Issue, changes: Record<string, string>, files: Files = {}) {
    const expect = identity(issue);
    let res: Response | null = null;
    if (files.issue || files.solution) {
      const fd = new FormData();
      fd.set("changes", JSON.stringify(changes));
      fd.set("expect", JSON.stringify(expect));
      if (files.issue) fd.set("issueAudio", files.issue.blob, `issue.${extFor(files.issue.mime)}`);
      if (files.solution) fd.set("solutionAudio", files.solution.blob, `solution.${extFor(files.solution.mime)}`);
      res = await authedFetch(`/api/issues/${issue.row}`, { method: "PATCH", body: fd }).catch(() => null);
    } else {
      res = await authedFetch(`/api/issues/${issue.row}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes, expect }),
      }).catch(() => null);
    }
    if (!res) return { ok: false as const, reason: "network" };
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
    if (res.ok && j.ok) return { ok: true as const };
    return { ok: false as const, reason: j.reason || `http_${res.status}` };
  }

  /** Optimistic status change; reverts and explains on failure. */
  async function setStatus(issue: Issue, next: string) {
    if (next === issue.status) return;
    setIssues((list) => (list ?? []).map((i) => (i.row === issue.row ? { ...i, status: next } : i)));
    const r = await patchIssue(issue, { status: next });
    if (!r.ok) {
      setIssues((list) => (list ?? []).map((i) => (i.row === issue.row ? { ...i, status: issue.status } : i)));
      notify("err", errorText(r.reason));
      if (r.reason === "row_changed") load();
    }
  }

  async function saveEdit(issue: Issue, changes: Record<string, string>, files: Files) {
    const r = await patchIssue(issue, changes, files);
    if (r.ok) { notify("ok", t.saved); setOpenRow(null); await load(); }
    return r;
  }

  /** Hand one issue to the ask page: a snapshot in sessionStorage, one hop. */
  function askAbout(i: IssueSnap) {
    try { sessionStorage.setItem(ASK_ISSUE_KEY, JSON.stringify(i)); } catch { /* private window: it opens as a general question */ }
    router.push("/dashboard/ask?new=issue");
  }
  const snapOf = (i: Issue): IssueSnap => ({
    row: i.row, date: i.date, machine: i.machine, product: i.product, category: i.category,
    description: i.description, action: i.action, status: i.status, note: i.note,
  });
  /** The issue just saved: its row once the list shows it, else as it was typed (row 0). */
  function askAboutSaved(d: Draft) {
    const same = (a: string, b: string) => a.trim() === b.trim();
    const hit = (issues ?? []).find((i) => same(i.date, d.date) && same(i.machine, d.machine) && same(i.product, d.product) && same(i.description, d.description));
    askAbout(hit ? snapOf(hit) : { row: 0, ...d });
  }

  const counts = useMemo(() => countByStatus(issues ?? []), [issues]);
  // The moulds the log names, each once (by productKey), in the log's own
  // spelling, with how many issues it carries — the mould filter.
  const productOptions = useMemo(() => {
    const byKey = new Map<string, { label: string; count: number }>();
    for (const i of issues ?? []) {
      const k = productKey(i.product);
      if (!k) continue;
      const cur = byKey.get(k);
      if (cur) cur.count++; else byKey.set(k, { label: i.product.trim(), count: 1 });
    }
    return Array.from(byKey.entries()).map(([key, v]) => ({ key, ...v })).sort((a, b) => a.label.localeCompare(b.label, "ar"));
  }, [issues]);
  // The mould number for each product the log names — the chip on the cards
  // and rows. A name Master holds twice (24 of them) gets a number only when
  // every twin carries the same one: the first twin's number beside the name
  // could be another customer's mould, and on a maintenance log a wrong
  // number is worse than none.
  const moldOf = useMemo(() => {
    const m = new Map<string, string>();
    if (!master) return m;
    for (const o of productOptions) {
      const twins = master.filter((r) => productKey(r.name) === o.key);
      const numbers = new Set(twins.map((r) => r.number));
      m.set(o.key, twins.length > 0 && numbers.size === 1 ? twins[0].number : "");
    }
    return m;
  }, [master, productOptions]);
  const moldNumberOf = (product: string) => moldOf.get(productKey(product)) ?? "";
  // The search also finds a mould by the number printed on its chip: the
  // number is joined into the row's haystack here, so lib/issues.ts stays
  // import-free.
  const filtered = useMemo(
    () => (issues ?? []).filter((i) => {
      const number = moldOf.get(productKey(i.product)) ?? "";
      const hay = number ? { ...i, note: `${i.note} ${number}` } : i;
      return matchesIssue(hay, { status: statusFilter, product: productFilter, machine: machineFilter, category: catFilter, query });
    }),
    [issues, moldOf, statusFilter, productFilter, machineFilter, catFilter, query],
  );
  // Issues on the same mould as this one, this one excluded.
  const otherOnMold = (issue: Issue) => {
    const k = productKey(issue.product);
    return k ? (issues ?? []).filter((i) => i.row !== issue.row && productKey(i.product) === k).length : 0;
  };
  // «اعرضهم»: the list promised «{n} عطل على الاسطمبة دي», so every other
  // filter is cleared first — a status tile or search text left on would show
  // fewer than promised with no hint why.
  const showMold = (product: string) => {
    const k = productKey(product);
    if (!productOptions.some((x) => x.key === k)) return;
    setStatusFilter(""); setMachineFilter(""); setCatFilter(""); setQuery("");
    setProductFilter(k);
  };
  // The registry first; any label the log holds that the registry no longer
  // does (it has been renumbered four times) stays selectable for old rows.
  const machineOptions = useMemo(() => {
    const seen = new Set(machines.map((m) => m.label));
    const extra = Array.from(new Set((issues ?? []).map((i) => i.machine).filter((m) => m && !seen.has(m))));
    return [...machines.map((m) => m.label), ...extra];
  }, [machines, issues]);
  const anyFilter = Boolean(statusFilter || productFilter || machineFilter || catFilter || query);
  const selected = openRow === null ? null : (issues ?? []).find((i) => i.row === openRow) ?? null;

  const dateText = (iso: string) => {
    const d = dayLabel(iso, today);
    return d === "today" ? t.today : d === "yesterday" ? t.yesterday : formatDate(iso, lang) || iso;
  };
  const catText = (c: string) => (c ? t.catLabels[c] || c : "");
  const n = (v: number) => fmtNum(v, isAr);

  const cycle = (issue: Issue) => setStatus(issue, NEXT_STATUS[issue.status] || "مفتوح");
  const signedIn = !authLoading && Boolean(user);

  return (
    <div className="max-w-5xl" dir={isAr ? "rtl" : "ltr"}>
      <div className="mb-5 sm:mb-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">{t.title}</h1>
          {/* Wrapped, not `hidden` on the Btn itself: its own `inline-flex`
              is a display utility too and wins over `hidden` (seen on a 375px
              screen — both buttons showed). */}
          <div className="hidden sm:block">
            <Btn onClick={() => setAdding(true)} disabled={!signedIn}>
              <Plus size={15} /> {t.add}
            </Btn>
          </div>
        </div>
        <p className="text-sm text-gray-500">{t.subtitle}</p>
        {/* On a phone the one thing a worker comes here to do is the whole width of the screen. */}
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={!signedIn}
          className="sm:hidden mt-4 w-full min-h-[64px] rounded-2xl border-2 border-red-600 bg-red-600 text-white text-lg font-semibold inline-flex items-center justify-center gap-3 shadow-sm active:scale-[0.98] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1"
        >
          {audioOk ? <Mic size={22} /> : <Plus size={22} />} {t.add}
        </button>
      </div>

      {mayAsk && askOffer && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border-2 border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <span className="min-w-0 flex-1">{askT.askAboutSaved}</span>
          <Btn onClick={() => askAboutSaved(askOffer)}><MessageCircleQuestionMark size={16} /> {askT.askAbout}</Btn>
          <button
            type="button" onClick={() => setAskOffer(null)} aria-label={p.common.cancel}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-blue-700 hover:bg-blue-100"
          >
            <X size={18} />
          </button>
        </div>
      )}
      {notice && (
        <div
          role="status"
          className={`mb-4 rounded-xl border-2 px-4 py-3 text-sm ${notice.kind === "ok" ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-700"}`}
        >
          {notice.text}
        </div>
      )}

      {/* The three tiles filter — tap «مفتوح» and the list is the open faults. */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-4 max-w-xl">
        {ISSUE_STATUSES.map((s) => (
          <StatTile
            key={s}
            label={t.statusLabels[s] || s}
            value={n(counts[s])}
            tone={statusTone(s)}
            active={statusFilter === s}
            onClick={() => setStatusFilter(statusFilter === s ? "" : s)}
          />
        ))}
      </div>

      {/* Filters: mould, machine, category, text. Wrap freely — four controls
          in one un-wrapping row is how the storage header overflowed a phone. */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-4">
        <select
          className={`${inputCls} w-full sm:w-56`}
          value={productFilter}
          onChange={(e) => setProductFilter(e.target.value)}
          aria-label={t.mold}
        >
          <option value="">{t.allMolds}</option>
          {/* The KEY is the value: the label is the newest spelling seen for
              that key and may change between polls; matchesIssue folds the
              filter through productKey too, so a key filters the same. */}
          {productOptions.map((o) => <option key={o.key} value={o.key}>{`${o.label} (${n(o.count)})`}</option>)}
        </select>
        <select
          className={`${inputCls} w-full sm:w-56`}
          value={machineFilter}
          onChange={(e) => setMachineFilter(e.target.value)}
          aria-label={t.machine}
        >
          <option value="">{t.allMachines}</option>
          {machineOptions.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <input
          className={`${inputCls} w-full sm:w-64`}
          placeholder={t.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t.search}
        />
        <div className="flex gap-2 overflow-x-auto w-full sm:w-auto -mx-1 px-1 py-0.5">
          <button type="button" onClick={() => setCatFilter("")} className={chipCls(catFilter === "")}>{t.allCategories}</button>
          {CATEGORY_ORDER.map((c) => (
            <button key={c} type="button" onClick={() => setCatFilter(catFilter === c ? "" : c)} className={chipCls(catFilter === c)}>
              {catText(c)}
            </button>
          ))}
        </div>
        {anyFilter && (
          <button
            type="button"
            onClick={() => { setStatusFilter(""); setProductFilter(""); setMachineFilter(""); setCatFilter(""); setQuery(""); }}
            className="inline-flex items-center gap-1 min-h-11 sm:min-h-0 px-2 text-sm text-blue-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 rounded-lg"
          >
            <X size={14} /> {t.clearFilters}
          </button>
        )}
      </div>

      {/* A read that failed with a list already on screen: keep the list, say
          what happened, offer the retry. Never blank, never an empty list. */}
      {loadErr && issues !== null && (
        <LoadError
          variant="banner"
          className="mb-4"
          text={loadErr === "timeout" ? p.common.timedOut : p.common.loadError}
          retry={p.common.retry}
          onRetry={() => load()}
        />
      )}
      {/* The device's last answer is showing while the live one is still coming. */}
      {!loadErr && refreshing && issues !== null && (
        <p className="mb-3 text-xs text-gray-500">{p.common.stillLoading}</p>
      )}

      {issues === null ? (
        loadErr ? (
          <LoadError
            variant="empty"
            text={loadErr === "timeout" ? p.common.timedOut : p.common.loadError}
            retry={p.common.retry}
            onRetry={() => load()}
          />
        ) : (
          <div className="flex justify-center py-16">
            <Spinner text={p.common.loading} />
          </div>
        )
      ) : filtered.length === 0 ? (
        <EmptyState text={anyFilter ? t.noneMatch : t.empty} />
      ) : (
        <>
          {/* Phone: stacked cards, each opens */}
          <div className="md:hidden space-y-3">
            {filtered.map((i) => (
              <div
                key={i.row}
                role="button"
                tabIndex={0}
                onClick={() => setOpenRow(i.row)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenRow(i.row); } }}
                className="bg-white border border-gray-200 rounded-xl px-4 py-3 cursor-pointer hover:border-blue-300 active:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
              >
                <div className="flex items-center justify-between gap-3 min-w-0">
                  {/* The chip sits OUTSIDE the truncating span: a long name
                      used to clip the mould number off entirely at 375px. */}
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="font-semibold text-gray-900 leading-snug min-w-0 truncate">
                      {i.product ? i.product : i.machine ? <bdi dir="ltr">{i.machine}</bdi> : "—"}
                    </span>
                    {i.product && <span className="shrink-0"><MoldChip number={moldNumberOf(i.product)} title={t.moldNumber} /></span>}
                  </span>
                  <StatusPill issue={i} t={t} onCycle={cycle} />
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {dateText(i.date)}{i.category ? ` · ${catText(i.category)}` : ""}
                  {i.machine && i.product ? <> · <bdi dir="ltr">{i.machine}</bdi></> : null}
                </div>
                <div className="mt-2 flex flex-wrap items-start gap-2">
                  {i.issueAudio && <Stop><SavedClip clip={i.issueAudio} strings={t} compact /></Stop>}
                  {i.description && <p className="text-sm text-gray-700 leading-relaxed min-w-0 flex-1">{i.description}</p>}
                </div>
                {(i.action || i.solutionAudio) && (
                  <div className="mt-1.5 flex flex-wrap items-start gap-2 text-blue-700">
                    <span className="text-xs mt-1">↳</span>
                    {i.solutionAudio && <Stop><SavedClip clip={i.solutionAudio} strings={t} compact /></Stop>}
                    {i.action && <p className="text-xs leading-relaxed min-w-0 flex-1 mt-1">{i.action}</p>}
                  </div>
                )}
                {i.note && <p className="text-xs text-gray-400 mt-1">{i.note}</p>}
              </div>
            ))}
          </div>

          {/* Desktop: table, each row opens */}
          <div className="hidden md:block bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/50">
                    {[t.date, t.mold, t.machine, t.category, t.problem, t.solution, t.status].map((h) => (
                      <th key={h} className="text-start px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((i) => (
                    <tr
                      key={i.row}
                      onClick={() => setOpenRow(i.row)}
                      className="hover:bg-blue-50/40 transition-colors align-top cursor-pointer"
                    >
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap tabular-nums">{dateText(i.date)}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {i.product ? <>{i.product} <MoldChip number={moldNumberOf(i.product)} title={t.moldNumber} /></> : i.machine ? <bdi dir="ltr">{i.machine}</bdi> : "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{i.machine ? <bdi dir="ltr">{i.machine}</bdi> : "—"}</td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{catText(i.category) || "—"}</td>
                      <td className="px-4 py-3 text-gray-700 max-w-md">
                        <div className="flex flex-col gap-1.5">
                          {i.issueAudio && <Stop><SavedClip clip={i.issueAudio} strings={t} compact /></Stop>}
                          {i.description ? <span>{i.description}</span> : !i.issueAudio ? "—" : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-500 max-w-xs">
                        <div className="flex flex-col gap-1.5">
                          {i.solutionAudio && <Stop><SavedClip clip={i.solutionAudio} strings={t} compact /></Stop>}
                          {i.action ? <span>{i.action}</span> : !i.solutionAudio ? "—" : null}
                        </div>
                      </td>
                      <td className="px-4 py-3"><StatusPill issue={i} t={t} onCycle={cycle} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Mounted only while open, and the drawer keyed by row: every opening
          starts from a clean form and a silent microphone. */}
      {adding && (
        <NewIssueSheet
          open
          onClose={() => setAdding(false)}
          onSaved={(d) => { notify("ok", t.logged); setAskOffer(d); load(); }}
          onRefresh={load}
          machines={machines}
          master={master}
          masterFailed={masterFailed}
          onRetryMaster={loadMaster}
          audioOk={audioOk}
          t={t}
          c={p.common}
          isAr={isAr}
          errorText={errorText}
        />
      )}

      {selected && (
        <IssueDrawer
          key={selected.row}
          issue={selected}
          onClose={() => setOpenRow(null)}
          onStatus={setStatus}
          onSave={saveEdit}
          machines={machineOptions}
          master={master}
          masterFailed={masterFailed}
          onRetryMaster={loadMaster}
          onReloadMaster={reloadMaster}
          onMasterNotes={(row, notes) => setMaster((list) => (list ?? []).map((r) => (r.row === row ? { ...r, notes } : r)))}
          changeLabel={p.jobs.changeProduct}
          moldNumber={moldNumberOf(selected.product)}
          othersOnMold={otherOnMold(selected)}
          onShowMold={() => { setOpenRow(null); showMold(selected.product); }}
          onAsk={mayAsk ? () => askAbout(snapOf(selected)) : undefined}
          askLabel={askT.askAbout}
          audioOk={audioOk}
          t={t}
          c={p.common}
          isAr={isAr}
          lang={lang}
          errorText={errorText}
          dateText={dateText}
        />
      )}
    </div>
  );
}

/* ------------------------------ small parts ------------------------------ */

function StatusPill({ issue, t, onCycle }: { issue: Issue; t: Strings; onCycle: (issue: Issue) => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onCycle(issue); }}
      title={t.tapStatus}
      // 26px measured, and the floor taps this to move an issue along. The
      // pill stays small so the list still scans, but an invisible ::after
      // grows the hit area to ~46px rather than making the badge look like a
      // button.
      className={`relative shrink-0 inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full border whitespace-nowrap transition-colors after:content-[''] after:absolute after:-inset-2.5 sm:after:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${statusCls(issue.status)}`}
    >
      {t.statusLabels[issue.status] || issue.status}
    </button>
  );
}

/** Keeps a tap on a player or a pill from also opening the drawer. */
function Stop({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={className} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>{children}</span>
  );
}

/** The mould number beside a product name — small, Latin, never reversed inside Arabic. */
function MoldChip({ number, title }: { number: string; title: string }) {
  if (!number) return null;
  return (
    <bdi
      dir="ltr"
      title={title}
      className="inline-flex items-center align-middle rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] font-medium text-gray-600 tabular-nums"
    >
      {number}
    </bdi>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50/60 p-3 mb-3">
      <span className="block text-xs font-semibold text-gray-700 mb-2">{title}</span>
      {children}
    </div>
  );
}


/* ------------------------------ category chips --------------------------- */

function CategoryChips({ value, onChange, t }: { value: string; onChange: (c: string) => void; t: Strings }) {
  return (
    <div className="flex flex-wrap gap-2">
      {CATEGORY_ORDER.map((c) => (
        <button key={c} type="button" onClick={() => onChange(c)} className={chipCls(value === c)} aria-pressed={value === c}>
          {t.catLabels[c] || c}
        </button>
      ))}
    </div>
  );
}

/** The machine dropdown — the registry, plus the value the row already holds when the registry no longer lists it. */
function MachineSelect({ label, value, onChange, machines }: { label: string; value: string; onChange: (v: string) => void; machines: string[] }) {
  const opts = value && !machines.includes(value) ? [value, ...machines] : machines;
  return (
    <Field label={label}>
      <select className={`${inputCls} text-base sm:text-sm`} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {opts.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
    </Field>
  );
}

/* ------------------------------ new issue -------------------------------- */

function NewIssueSheet({
  open, onClose, onSaved, onRefresh, machines, master, masterFailed, onRetryMaster, audioOk, t, c, isAr, errorText,
}: {
  open: boolean; onClose: () => void; onSaved: (saved: Draft) => void; onRefresh: () => void;
  machines: Machine[]; master: MasterRow[] | null; masterFailed: boolean; onRetryMaster: () => void; audioOk: boolean;
  t: Strings; c: Common; isAr: boolean; errorText: (reason: string) => string;
}) {
  const issueRec = useAudioRecorder();
  const solRec = useAudioRecorder();
  const blank = (): Draft => ({
    date: cairoToday(), machine: "", product: "", category: DEFAULT_CATEGORY,
    description: "", action: "", status: "مفتوح", note: "",
  });
  const [form, setForm] = useState<Draft>(blank);
  // The product is PICKED from «الرئيسي» (Master's exact spelling is what the
  // row gets); a machine fault has none.
  const [picked, setPicked] = useState<MasterPick | null>(null);
  const machineMain = isMachineCategory(form.category);
  const [more, setMore] = useState(false);
  const [withSolution, setWithSolution] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof Draft, v: string) => setForm((f) => ({ ...f, [k]: v }));
  // Mounted fresh on every opening (the page renders it only while `adding`),
  // so there is nothing to reset here — a closed sheet is an unmounted one.
  const resetSol = solRec.reset;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const files: Files = { issue: issueRec.recording ?? undefined, solution: withSolution ? solRec.recording ?? undefined : undefined };
    if (!hasProblem(form.description, Boolean(files.issue))) { setErr(t.descRequired); return; }
    if (filesBytes(files) > MAX_REQUEST_BYTES) { setErr(t.audioTooLong); return; }
    setSaving(true); setErr(null);
    try {
      const fd = new FormData();
      const draft = { ...form, product: picked?.name ?? "", action: withSolution ? form.action : "" };
      for (const [k, v] of Object.entries(draft)) fd.set(k, v);
      if (files.issue) fd.set("issueAudio", files.issue.blob, `issue.${extFor(files.issue.mime)}`);
      if (files.solution) fd.set("solutionAudio", files.solution.blob, `solution.${extFor(files.solution.mime)}`);
      const res = await authedFetch("/api/issues", { method: "POST", body: fd });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
      if (!res.ok || !j.ok) {
        setErr(errorText(j.reason || `http_${res.status}`)); setSaving(false);
        // The bridge is at-least-once: a "failed" save may have landed (seen
        // 2026-09-09). Refresh the list behind the sheet so the row shows up
        // and nobody saves it twice.
        onRefresh();
        return;
      }
      setSaving(false);
      onSaved(draft);
      onClose();
    } catch {
      setErr(t.saveFailed); setSaving(false);
    }
  }

  return (
    <Modal open={open} title={t.add} onClose={onClose} isAr={isAr}>
      <form onSubmit={submit}>
        {/* Mould-first (owner, 2026-10-07): what kind of fault, then WHICH
            mould. The machine is up front only for a machine/electrical
            fault; otherwise it waits under «حقول إضافية». */}
        <div className="mb-3">
          <span className="block text-xs font-medium text-gray-600 mb-1.5">{t.category}</span>
          <CategoryChips
            value={form.category}
            onChange={(v) => {
              // A machine chosen under a machine category must stay in view
              // when the category stops being one: the select moves under
              // «حقول إضافية», which opens so the value is never sent unseen.
              if (isMachineCategory(form.category) && !isMachineCategory(v) && form.machine) setMore(true);
              set("category", v);
            }}
            t={t}
          />
        </div>
        {/* Not a <Field>: a <label> around a search box and a list of buttons
            sends every tap to the first control. No autoFocus: the keyboard
            would cover the record button on a phone, on a voice-first form. */}
        <div className="mb-3">
          <span className="block text-xs font-medium text-gray-600 mb-1">{t.mold}</span>
          <MasterProductPicker
            rows={master ?? []}
            value={picked}
            onChange={setPicked}
            loading={master === null && !masterFailed}
            failed={masterFailed}
            onRetry={onRetryMaster}
            autoFocus={false}
          />
        </div>
        {machineMain && <MachineSelect label={t.machine} value={form.machine} onChange={(v) => set("machine", v)} machines={machines.map((m) => m.label)} />}

        {/* THE PROBLEM — the big button first; words are optional once it is recorded. */}
        <div className="mb-3 rounded-2xl border border-gray-200 bg-gray-50/60 p-3">
          <span className="block text-xs font-semibold text-gray-700 mb-2">{t.problem}</span>
          <AudioField
            recorder={issueRec}
            audioOk={audioOk}
            recordLabel={t.recordProblem}
            textLabel={audioOk ? t.typeProblem : t.description}
            value={form.description}
            onChange={(v) => set("description", v)}
            rows={3}
            disabled={saving}
            strings={t}
            noAudioNote={t.audioNeedsBridge}
          />
        </div>

        {/* THE SOLUTION — folded: most faults are logged before they are fixed. */}
        {!withSolution ? (
          <button
            type="button"
            onClick={() => setWithSolution(true)}
            className="mb-3 inline-flex items-center gap-1.5 min-h-11 px-2 -mx-2 rounded-lg text-sm font-medium text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          >
            <Plus size={15} /> {t.addSolution}
          </button>
        ) : (
          <div className="mb-3 rounded-2xl border border-gray-200 bg-gray-50/60 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="block text-xs font-semibold text-gray-700">{t.solution}</span>
              <button type="button" onClick={() => { setWithSolution(false); resetSol(); set("action", ""); }} aria-label={c.cancel}
                className="min-w-11 min-h-11 -me-2 inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40">
                <X size={16} />
              </button>
            </div>
            <AudioField
              recorder={solRec}
              audioOk={audioOk}
              recordLabel={t.recordSolution}
              textLabel={audioOk ? t.typeSolution : t.action}
              value={form.action}
              onChange={(v) => set("action", v)}
              rows={2}
              disabled={saving}
              strings={t}
            />
          </div>
        )}

        <button
          type="button"
          onClick={() => setMore((m) => !m)}
          className="mb-2 inline-flex items-center gap-1 min-h-11 px-2 -mx-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          aria-expanded={more}
        >
          {more ? <ChevronUp size={15} /> : <ChevronDown size={15} />} {t.moreFields}
        </button>
        {more && (
          <div className="grid sm:grid-cols-2 gap-x-4">
            <Field label={t.date}>
              <input className={inputCls} type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
            </Field>
            {!machineMain && <MachineSelect label={t.machineOptional} value={form.machine} onChange={(v) => set("machine", v)} machines={machines.map((m) => m.label)} />}
            <Field label={t.status}>
              <select className={inputCls} value={form.status} onChange={(e) => set("status", e.target.value)}>
                {ISSUE_STATUSES.map((s) => <option key={s} value={s}>{t.statusLabels[s] || s}</option>)}
              </select>
            </Field>
            <Field label={t.note}>
              <input className={inputCls} value={form.note} onChange={(e) => set("note", e.target.value)} />
            </Field>
          </div>
        )}

        {err && <p className="text-sm text-red-600 mb-2">{err}</p>}
        <div className="flex flex-wrap items-center gap-3 mt-2">
          <Btn type="submit" disabled={saving || issueRec.state === "recording" || solRec.state === "recording"}>
            {saving ? t.saving : t.add}
          </Btn>
          <Btn type="button" variant="outline" onClick={onClose}>{c.cancel}</Btn>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------ opened issue ----------------------------- */

function IssueDrawer({
  issue, onClose, onStatus, onSave, machines, master, masterFailed, onRetryMaster, onReloadMaster, onMasterNotes, changeLabel,
  moldNumber, othersOnMold, onShowMold, onAsk, askLabel, audioOk, t, c, isAr, lang, errorText, dateText,
}: {
  issue: Issue | null;
  onClose: () => void;
  onStatus: (issue: Issue, next: string) => Promise<void>;
  onSave: (issue: Issue, changes: Record<string, string>, files: Files) => Promise<{ ok: true } | { ok: false; reason: string }>;
  machines: string[]; master: MasterRow[] | null; masterFailed: boolean; onRetryMaster: () => void; onReloadMaster: () => void;
  onMasterNotes: (row: number, notes: string) => void;
  changeLabel: string;
  moldNumber: string; othersOnMold: number; onShowMold: () => void;
  /** «اسأل Claude» about this issue — absent for a role that may not ask. */
  onAsk?: () => void; askLabel: string;
  audioOk: boolean;
  t: Strings; c: Common; isAr: boolean; lang: "ar" | "en";
  errorText: (reason: string) => string;
  dateText: (iso: string) => string;
}) {
  const issueRec = useAudioRecorder();
  const solRec = useAudioRecorder();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // «تغيير» on the picker opens the search list WITHOUT blanking the draft's
  // product; only «بدون منتج» blanks it, and a pick replaces it.
  const [changingProduct, setChangingProduct] = useState(false);
  // The Master ROW the person tapped — for a name Master holds twice, the
  // name alone would show the first twin's client and number again.
  const [pickedRow, setPickedRow] = useState<MasterPick | null>(null);
  const solutionRef = useRef<HTMLDivElement>(null);
  // Keyed by row where the page renders it: opening another issue mounts a
  // fresh drawer, so no state has to be reset here.
  const resetIssue = issueRec.reset;
  const resetSol = solRec.reset;

  if (!issue) return null;
  const original: Draft = {
    date: issue.date, machine: issue.machine, product: issue.product, category: issue.category,
    description: issue.description, action: issue.action, status: issue.status, note: issue.note,
  };
  const draft = form ?? original;
  const set = (k: keyof Draft, v: string) => setForm((f) => ({ ...(f ?? original), [k]: v }));
  const startEditing = (toSolution = false) => {
    setForm(original); setEditing(true); setErr(null); setChangingProduct(false); setPickedRow(null);
    if (toSolution) setTimeout(() => solutionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  };
  const noSolution = !issue.action && !issue.solutionAudio;

  // An arrow, not a hoisted function declaration: TypeScript keeps the
  // `issue` null-check above only for code that follows it.
  const save = async () => {
    if (saving) return;
    const files: Files = { issue: issueRec.recording ?? undefined, solution: solRec.recording ?? undefined };
    const changes = diffIssue(original, draft) as Record<string, string>;
    const description = changes.description ?? issue.description;
    if (!hasProblem(description, Boolean(files.issue || issue.issueAudio))) { setErr(t.descRequired); return; }
    if (filesBytes(files) > MAX_REQUEST_BYTES) { setErr(t.audioTooLong); return; }
    if (Object.keys(changes).length === 0 && !files.issue && !files.solution) { setEditing(false); return; }
    setSaving(true); setErr(null);
    const r = await onSave(issue, changes, files);
    setSaving(false);
    if (!r.ok) setErr(errorText(r.reason));
  };

  return (
    <Modal open title={t.details} onClose={onClose} isAr={isAr}>
      {/* identity — the mould first, the machine second */}
      <div className="mb-3">
        <p className="text-lg font-semibold text-gray-900 break-words">
          {issue.product ? <>{issue.product} <MoldChip number={moldNumber} title={t.moldNumber} /></> : issue.machine ? <bdi dir="ltr">{issue.machine}</bdi> : "—"}
        </p>
        <p className="text-xs text-gray-500 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="tabular-nums" title={issue.date}>{dateText(issue.date)}</span>
          {issue.category && <span>· {t.catLabels[issue.category] || issue.category}</span>}
          {issue.machine && issue.product && <span>· <bdi dir="ltr">{issue.machine}</bdi></span>}
        </p>
        {!editing && issue.product && othersOnMold > 0 && (
          <p className="text-xs text-gray-600 mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{fill(t.moldIssues, { n: othersOnMold })}</span>
            <button
              type="button"
              onClick={onShowMold}
              className="inline-flex items-center min-h-11 sm:min-h-0 px-1 text-blue-600 font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 rounded"
            >
              {t.showMoldIssues}
            </button>
          </p>
        )}
      </div>

      {!editing ? (
        <>
          {/* status — one tap, saved at once */}
          <div className="mb-4">
            <span className="block text-xs font-medium text-gray-600 mb-1.5">{t.status}</span>
            <div className="grid grid-cols-3 gap-2">
              {ISSUE_STATUSES.map((s: IssueStatus) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onStatus(issue, s)}
                  aria-pressed={issue.status === s}
                  className={`min-h-11 rounded-xl border-2 px-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
                    issue.status === s ? statusCls(s).replace("border-", "border-2 border-") + " ring-1 ring-current/20" : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"
                  }`}
                >
                  {t.statusLabels[s] || s}
                </button>
              ))}
            </div>
          </div>

          <Section title={t.problem}>
            {issue.issueAudio && <div className="mb-2"><SavedClip clip={issue.issueAudio} strings={t} /></div>}
            {issue.description ? <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{issue.description}</p>
              : !issue.issueAudio ? <p className="text-sm text-gray-400">—</p> : null}
          </Section>

          <Section title={t.solution}>
            {noSolution ? (
              <>
                <p className="text-sm text-gray-500 mb-3">{t.noSolutionYet}</p>
                <button
                  type="button"
                  onClick={() => startEditing(true)}
                  className="w-full min-h-[56px] rounded-2xl border-2 border-blue-600 bg-blue-600 text-white text-base font-semibold inline-flex items-center justify-center gap-2 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1"
                >
                  {audioOk ? <Mic size={20} /> : <Pencil size={18} />} {t.addSolution}
                </button>
              </>
            ) : (
              <>
                {issue.solutionAudio && <div className="mb-2"><SavedClip clip={issue.solutionAudio} strings={t} /></div>}
                {issue.action && <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{issue.action}</p>}
              </>
            )}
          </Section>

          {issue.note && (
            <Section title={t.note}>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{issue.note}</p>
            </Section>
          )}

          {/* THE ONLY WRITE TO MASTER — previewed, on an explicit save. */}
          {issue.product.trim() !== "" && (
            <IssueMasterNotes
              product={issue.product}
              issue={{ date: issue.date, description: issue.description, action: issue.action }}
              master={master}
              masterFailed={masterFailed}
              onRetry={onRetryMaster}
              onReload={onReloadMaster}
              onSaved={onMasterNotes}
              changeLabel={changeLabel}
              t={t}
              c={c}
            />
          )}

          <div className="flex flex-wrap items-center gap-3 mt-2">
            {onAsk && <Btn onClick={onAsk}><MessageCircleQuestionMark size={16} /> {askLabel}</Btn>}
            <Btn variant="outline" onClick={() => startEditing(false)}><Pencil size={14} /> {c.edit}</Btn>
            <Btn variant="ghost" onClick={onClose}>{c.cancel}</Btn>
          </div>
        </>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <div className="mb-3">
            <span className="block text-xs font-medium text-gray-600 mb-1.5">{t.category}</span>
            <CategoryChips value={draft.category} onChange={(v) => set("category", v)} t={t} />
          </div>
          {/* Not a <Field> — see the new-issue form. The picker shows the Master
              row the draft names; a recorded name Master does not hold stays
              on the row (grey line) until something is picked. */}
          <div className="mb-3">
            <span className="block text-xs font-medium text-gray-600 mb-1">{t.mold}</span>
            {(() => {
              const tapped = pickedRow && productKey(pickedRow.name) === productKey(draft.product) ? pickedRow : null;
              const matched = master && !changingProduct ? tapped ?? findProduct(master, draft.product) : null;
              return (
                <>
                  {!matched && draft.product.trim() !== "" && (
                    <p className="text-xs text-gray-500 mb-1.5">{t.currentProduct}: {draft.product}</p>
                  )}
                  {/* The keyboard opens only after «تغيير» was tapped — not on
                      «إضافة الحل» for an issue whose product is blank. */}
                  <MasterProductPicker
                    rows={master ?? []}
                    value={matched}
                    onChange={(m) => {
                      if (m) { set("product", m.name); setPickedRow(m); setChangingProduct(false); }
                      else setChangingProduct(true);
                    }}
                    loading={master === null && !masterFailed}
                    failed={masterFailed}
                    onRetry={onRetryMaster}
                    autoFocus={changingProduct}
                  />
                  {draft.product.trim() !== "" && (
                    <button
                      type="button"
                      onClick={() => { set("product", ""); setPickedRow(null); setChangingProduct(false); }}
                      className="mt-1.5 inline-flex items-center gap-1 min-h-11 sm:min-h-0 px-2 -mx-2 rounded-lg text-xs text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                    >
                      <X size={12} /> {t.clearProduct}
                    </button>
                  )}
                </>
              );
            })()}
          </div>
          <div className="grid sm:grid-cols-2 gap-x-4">
            <Field label={t.date}>
              <input className={inputCls} type="date" value={draft.date} onChange={(e) => set("date", e.target.value)} />
            </Field>
            <MachineSelect
              label={isMachineCategory(draft.category) ? t.machine : t.machineOptional}
              value={draft.machine}
              onChange={(v) => set("machine", v)}
              machines={machines}
            />
            <Field label={t.status}>
              <select className={inputCls} value={draft.status} onChange={(e) => set("status", e.target.value)}>
                {ISSUE_STATUSES.map((s) => <option key={s} value={s}>{t.statusLabels[s] || s}</option>)}
              </select>
            </Field>
          </div>

          <Section title={t.problem}>
            <AudioField
              recorder={issueRec}
              audioOk={audioOk}
              saved={issue.issueAudio}
              recordLabel={t.recordProblem}
              rerecordLabel={t.rerecord}
              textLabel={audioOk ? t.typeProblem : t.description}
              value={draft.description}
              onChange={(v) => set("description", v)}
              rows={3}
              disabled={saving}
              strings={t}
            />
          </Section>

          <div ref={solutionRef}>
            <Section title={t.solution}>
              <AudioField
                recorder={solRec}
                audioOk={audioOk}
                saved={issue.solutionAudio}
                recordLabel={t.recordSolution}
                rerecordLabel={t.rerecord}
                textLabel={audioOk ? t.typeSolution : t.action}
                value={draft.action}
                onChange={(v) => set("action", v)}
                rows={2}
                disabled={saving}
                strings={t}
              />
            </Section>
          </div>

          <Field label={t.note}>
            <input className={inputCls} value={draft.note} onChange={(e) => set("note", e.target.value)} />
          </Field>

          {err && <p className="text-sm text-red-600 mb-2">{err}</p>}
          <div className="flex flex-wrap items-center gap-3 mt-2">
            <Btn type="submit" disabled={saving || issueRec.state === "recording" || solRec.state === "recording"}>
              {saving ? t.saving : t.saveChanges}
            </Btn>
            <Btn type="button" variant="outline" onClick={() => { setEditing(false); setErr(null); setChangingProduct(false); setPickedRow(null); resetIssue(); resetSol(); }}>{c.cancel}</Btn>
          </div>
          <p className="sr-only">{formatDate(issue.date, lang)}</p>
        </form>
      )}
    </Modal>
  );
}
