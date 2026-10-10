"use client";
/**
 * «اسأل Claude» — a maintenance question, about a logged issue or a general
 * one (2026-10-10, owner).
 *
 * The page never talks to Claude. It posts the question to /api/ask, which
 * stores it as "waiting"; a listener on the owner's laptop answers through
 * its own routes, and this screen checks for the answer every few seconds
 * (4 s for the first minute, then 10 s — lib/ask.ts pollDelayMs). A question
 * asked while the laptop is off stays waiting and is answered when it is back.
 *
 * Three views in one page, kept in the address bar so a reload or a shared
 * link lands on the same thing: the list of my questions, a new question
 * (general, or about the issue the issues page handed over in
 * sessionStorage), and one thread.
 *
 * Built for a phone on a weak connection: the draft is never cleared until
 * the server has said yes, a failed send keeps the text and the photo and
 * says so, and the photo is resized here before it is sent.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ChevronLeft, ChevronRight, Plus, RotateCw, Send, X } from "lucide-react";
import { usePageTitle } from "@/components/dashboard/use-page-title";
import { Btn, EmptyState, Spinner } from "@/components/dashboard/ui";
import { timedJson } from "@/components/dashboard/last-seen";
import { useLang } from "@/context/LangContext";
import { useAuth } from "@/context/AuthContext";
import { authedFetch } from "@/lib/authed-fetch";
import { ak } from "@/lib/i18n.ask";
import { fill } from "@/lib/format";
import { formatClock, formatDate } from "@/lib/dates";
import {
  ASK_ISSUE_KEY, ISSUE_KINDS, issueKind, MAX_PHOTO_BYTES, MAX_QUESTION_CHARS, PHOTO_MAX_EDGE, PHOTO_TARGET_BYTES, pollDelayMs,
  type AskIssue, type IssueKind, type IssueSnap, type AskMessage, type AskStatus, type CapState,
} from "@/lib/ask";

type Strings = (typeof ak)["en"];
type Row = { id: string; title: string; status: AskStatus; updatedAt: number; hasIssue: boolean; last: { role: string; text: string } | null };
type ListResp = { ok: boolean; configured: boolean; online: boolean; lastBeatAt: number | null; cap: CapState | null; threads: Row[] };
type Thread = {
  id: string; title: string; status: AskStatus; createdAt: number; updatedAt: number;
  issue: AskIssue | null; messages: AskMessage[]; failure: { reason: string; at: number } | null; askedBy: string;
};
type ThreadResp = { ok: boolean; thread: Thread; online: boolean; mine: boolean };
type SendResp = { ok: boolean; reason?: string; thread?: Thread; cap?: CapState };
/** A row of «الأعطال» as /api/issues answers it (newest first). */
type LoggedIssue = IssueSnap & { issueAudio: unknown };
const PICK_STEP = 6;
type View = { kind: "list" } | { kind: "new"; issue: IssueSnap | null } | { kind: "thread"; id: string };
type Photo = { base64: string; url: string };

const SEND_TIMEOUT_MS = 45_000;

/* ------------------------------- the photo -------------------------------- */

function blobAt(canvas: HTMLCanvasElement, q: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", q));
}

/** Resize in the browser: longest edge 1280 px, JPEG, stepping down until it fits. */
async function preparePhoto(file: File): Promise<Photo | null> {
  try {
    const src = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("unreadable"));
      el.src = src;
    });
    let out: Blob | null = null;
    for (const edge of [PHOTO_MAX_EDGE, 1024, 800]) {
      const scale = Math.min(1, edge / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) break;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const q of [0.8, 0.65, 0.5]) {
        out = await blobAt(canvas, q);
        if (out && out.size <= PHOTO_TARGET_BYTES) break;
      }
      if (out && out.size <= PHOTO_TARGET_BYTES) break;
    }
    URL.revokeObjectURL(src);
    if (!out || out.size > MAX_PHOTO_BYTES) return null;
    const bytes = new Uint8Array(await out.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { base64: btoa(bin), url: URL.createObjectURL(out) };
  } catch {
    return null;
  }
}

/** A stored photo, fetched with the token (an <img src> cannot carry one). */
function StoredPhoto({ threadId, photoId, alt }: { threadId: string; photoId: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    let made: string | null = null;
    authedFetch(`/api/ask/photo?thread=${encodeURIComponent(threadId)}&id=${encodeURIComponent(photoId)}`)
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (!b || dead) return;
        made = URL.createObjectURL(b);
        setUrl(made);
      })
      .catch(() => {});
    return () => { dead = true; if (made) URL.revokeObjectURL(made); };
  }, [threadId, photoId]);
  if (!url) return <div className="h-32 w-44 rounded-lg bg-black/10 animate-pulse" aria-hidden />;
  // eslint-disable-next-line @next/next/no-img-element -- an object URL, not a static asset
  return <img src={url} alt={alt} className="max-h-64 w-auto max-w-full rounded-lg" />;
}

/* -------------------------------- the pieces ------------------------------- */

function StatusLight({ online, t }: { online: boolean; t: Strings }) {
  return (
    <p
      role="status"
      className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${
        online ? "border-green-200 bg-green-50 text-green-800" : "border-amber-300 bg-amber-50 text-amber-900"
      }`}
    >
      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${online ? "bg-green-500" : "bg-amber-500"}`} aria-hidden />
      <span>{online ? t.online : t.offline}</span>
    </p>
  );
}

const Advice = ({ t }: { t: Strings }) => (
  <p className="rounded-lg bg-gray-100 px-3 py-2 text-center text-xs font-medium text-gray-700">{t.advice}</p>
);

function IssueCard({ issue, t, isAr, verified }: { issue: IssueSnap; t: Strings; isAr: boolean; verified?: boolean }) {
  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/60 px-3.5 py-3 text-sm">
      <p className="text-xs font-medium text-blue-800">{t.aboutIssue}</p>
      <p className="mt-1 font-semibold text-gray-900 break-words">
        {issue.product || (issue.machine ? <bdi dir="ltr">{issue.machine}</bdi> : "—")}
      </p>
      <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-gray-600">
        {issue.date && <span className="tabular-nums">{formatDate(issue.date, isAr ? "ar" : "en") || issue.date}</span>}
        {issue.category && <span>· {issue.category}</span>}
        {issue.machine && issue.product && <span>· <bdi dir="ltr">{issue.machine}</bdi></span>}
      </p>
      {issue.description && <p className="mt-1.5 whitespace-pre-wrap break-words text-gray-800">{issue.description}</p>}
      {verified === false && <p className="mt-1.5 text-xs text-amber-800">{t.unverified}</p>}
    </div>
  );
}

function Composer({
  t, placeholder, busy, disabled, error, onSend,
}: {
  t: Strings; placeholder: string; busy: boolean; disabled: boolean; error: string | null;
  /** Resolves true when the server took it — only then is the draft cleared. */
  onSend: (text: string, photo: Photo | null) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [reading, setReading] = useState(false);
  const [photoErr, setPhotoErr] = useState(false);
  const pick = useRef<HTMLInputElement>(null);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setReading(true); setPhotoErr(false);
    const p = await preparePhoto(file);
    setReading(false);
    if (!p) { setPhotoErr(true); return; }
    setPhoto((old) => { if (old) URL.revokeObjectURL(old.url); return p; });
  };
  const submit = async () => {
    if (busy || disabled || reading || (!text.trim() && !photo)) return;
    if (await onSend(text.trim(), photo)) {
      setText("");
      setPhoto((old) => { if (old) URL.revokeObjectURL(old.url); return null; });
    }
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate className="space-y-2">
      {photo && (
        <div className="relative inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL */}
          <img src={photo.url} alt={t.photoAlt} className="h-24 w-auto rounded-lg border border-gray-200" />
          <button
            type="button" onClick={() => setPhoto((old) => { if (old) URL.revokeObjectURL(old.url); return null; })}
            aria-label={t.removePhoto}
            className="absolute -top-2 -end-2 inline-flex h-11 w-11 items-center justify-center rounded-full bg-gray-900/80 text-white"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {reading && <p className="text-xs text-gray-500">{t.photoReading}</p>}
      {photoErr && <p className="text-xs text-red-700">{t.photoFailed}</p>}
      <textarea
        value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={MAX_QUESTION_CHARS}
        placeholder={placeholder} disabled={disabled}
        className="block w-full rounded-xl border border-gray-300 bg-white px-3.5 py-3 text-base text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:bg-gray-50"
      />
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <div className="flex items-center gap-2">
        <input
          ref={pick} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ""; }}
        />
        <Btn variant="outline" onClick={() => pick.current?.click()} disabled={disabled || busy} className="min-h-12">
          <Camera size={18} /> {t.photo}
        </Btn>
        <Btn type="submit" disabled={disabled || busy || reading || (!text.trim() && !photo)} className="min-h-12 flex-1">
          <Send size={18} /> {busy ? t.sending : t.send}
        </Btn>
      </div>
    </form>
  );
}

/* --------------------------------- the page -------------------------------- */

const urlFor = (v: View) => (v.kind === "thread" ? `?t=${encodeURIComponent(v.id)}` : v.kind === "new" ? "?new=1" : "?");

export default function AskPage() {
  const { lang } = useLang();
  const { user, loading: authLoading } = useAuth();
  const isAr = lang === "ar";
  const t = ak[lang];
  usePageTitle(t.title);

  const [view, setView] = useState<View>({ kind: "list" });
  const [list, setList] = useState<ListResp | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [threadErr, setThreadErr] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  // Owner and manager may READ anybody's thread; only its asker writes in it.
  const [mine, setMine] = useState(true);
  const [cap, setCap] = useState<CapState | null>(null);
  const [busy, setBusy] = useState(false);
  /** The question has been waiting over a minute — set by the poll, never read off the clock in render. */
  const [longWait, setLongWait] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  // The logged issues offered on the first screen, as two kinds: moulds and
  // machines (owner, 2026-10-10). Nothing here reads «التوقفات».
  const [logged, setLogged] = useState<LoggedIssue[] | null>(null);
  const [loggedErr, setLoggedErr] = useState(false);
  const [kind, setKind] = useState<IssueKind>("mould");
  const [shown, setShown] = useState(PICK_STEP);
  const waitingSince = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);

  const reasonText = useCallback((reason: string | undefined, capNow?: CapState | null): string => {
    if (reason === "daily_cap") return fill(t.capReached, { limit: capNow?.limit ?? "" });
    const known = t.reasons as Record<string, string>;
    return (reason && known[reason]) || t.sendFailed;
  }, [t]);
  const httpReason = (status: number) => (status === 401 ? "unauthorized" : status === 403 ? "forbidden" : status === 404 ? "not_found" : undefined);

  const go = useCallback((v: View) => {
    setView(v); setSendErr(null); setThreadErr(null);
    if (v.kind !== "thread") setThread(null);
    window.history.replaceState(null, "", `${window.location.pathname}${urlFor(v)}`);
  }, []);

  // Where the address bar (or the issues page) says to start.
  // Once: the hand-over is read AND removed, and React runs a mount effect
  // twice in development — the second run would find nothing and drop the issue.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const q = new URLSearchParams(window.location.search);
    const id = q.get("t");
    // Deferred a tick, like every load below: an effect body that calls
    // setState synchronously is what the compiler's lint forbids.
    if (id) { void Promise.resolve().then(() => setView({ kind: "thread", id })); return; }
    if (q.get("new")) {
      let issue: IssueSnap | null = null;
      try {
        const raw = q.get("new") === "issue" ? sessionStorage.getItem(ASK_ISSUE_KEY) : null;
        if (raw) issue = JSON.parse(raw) as IssueSnap;
        sessionStorage.removeItem(ASK_ISSUE_KEY);
      } catch { /* a private window: a general question, then */ }
      void Promise.resolve().then(() => setView({ kind: "new", issue }));
    }
  }, []);

  const loadList = useCallback(async () => {
    const r = await timedJson<ListResp>(authedFetch, "/api/ask", {}, 30_000);
    if (!r.ok) { setListErr(reasonText(httpReason(r.status)) === t.sendFailed ? t.loadFailed : reasonText(httpReason(r.status))); return; }
    setListErr(null); setList(r.data); setOnline(r.data.online); setCap(r.data.cap);
  }, [reasonText, t]);

  const loadThread = useCallback(async (id: string) => {
    const r = await timedJson<ThreadResp>(authedFetch, `/api/ask/${encodeURIComponent(id)}`, {}, 30_000);
    if (!r.ok) {
      // A failed poll keeps what is on screen; only a first load shows the error.
      setThreadErr(r.status === 404 ? t.reasons.not_found : t.loadFailed);
      return;
    }
    setThreadErr(null); setThread(r.data.thread); setOnline(r.data.online); setMine(r.data.mine !== false);
  }, [t]);

  const loadLogged = useCallback(async () => {
    const r = await timedJson<{ issues?: LoggedIssue[] }>(authedFetch, "/api/issues", {}, 60_000);
    if (!r.ok || !Array.isArray(r.data.issues)) { setLoggedErr(true); return; }
    setLoggedErr(false); setLogged(r.data.issues);
  }, []);

  // authedFetch has no user for the first moments of a load.
  useEffect(() => {
    if (authLoading || !user) return;
    void Promise.resolve().then(loadList);
    // Its own call, never in front of the list: the issues log is a sheet read.
    void Promise.resolve().then(loadLogged);
  }, [authLoading, user, loadList, loadLogged]);

  const threadId = view.kind === "thread" ? view.id : "";
  useEffect(() => {
    if (authLoading || !user || !threadId) return;
    void Promise.resolve().then(() => loadThread(threadId));
  }, [authLoading, user, threadId, loadThread]);

  // Check for the answer while the question is waiting.
  const waiting = thread?.status === "waiting" || thread?.status === "claimed";
  useEffect(() => {
    if (!waiting || !threadId) { waitingSince.current = 0; return; }
    if (!waitingSince.current) waitingSince.current = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    let dead = false;
    const tick = async () => {
      if (dead) return;
      if (!document.hidden) await loadThread(threadId);
      if (!dead) setLongWait(Date.now() - waitingSince.current > 60_000);
      if (!dead) timer = setTimeout(tick, pollDelayMs(waitingSince.current, Date.now()));
    };
    timer = setTimeout(tick, pollDelayMs(waitingSince.current, Date.now()));
    return () => { dead = true; clearTimeout(timer); };
  }, [waiting, threadId, loadThread]);

  const count = thread?.messages.length ?? 0;
  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [count, waiting]);

  const post = async (url: string, body: unknown): Promise<boolean> => {
    setBusy(true); setSendErr(null); setLongWait(false);
    let res: Response | null = null;
    try {
      res = await authedFetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch { /* the weak connection — the draft stays */ }
    const data = res ? ((await res.json().catch(() => null)) as SendResp | null) : null;
    setBusy(false);
    if (!res || !data || !data.ok || !data.thread) {
      if (data?.cap) setCap(data.cap);
      setSendErr(reasonText(data?.reason ?? (res ? httpReason(res.status) : undefined), data?.cap));
      return false;
    }
    if (data.cap) setCap(data.cap);
    setThread(data.thread); setMine(true);
    if (view.kind !== "thread" || view.id !== data.thread.id) {
      setView({ kind: "thread", id: data.thread.id });
      window.history.replaceState(null, "", `${window.location.pathname}?t=${encodeURIComponent(data.thread.id)}`);
    }
    void loadList();
    return true;
  };

  const Back = isAr ? ChevronRight : ChevronLeft;
  const capLine = cap && cap.limit !== null
    ? (cap.allowed ? fill(t.capLeft, { n: cap.remaining ?? 0, limit: cap.limit }) : fill(t.capReached, { limit: cap.limit }))
    : null;
  const capBlocked = !!cap && !cap.allowed;
  const clock = (ms: number) => <bdi dir="ltr" className="tabular-nums">{formatClock(ms)}</bdi>;

  if (authLoading || (!list && !listErr && view.kind === "list")) {
    return <div className="py-16"><Spinner text={t.title} /></div>;
  }

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="mx-auto w-full max-w-2xl space-y-3 pb-6">
      <header className="flex items-center gap-2">
        {view.kind !== "list" && (
          <button
            type="button" onClick={() => { go({ kind: "list" }); void loadList(); }} aria-label={t.back}
            className="-ms-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100"
          >
            <Back size={22} />
          </button>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold text-gray-900">{view.kind === "thread" && thread ? thread.title || t.title : t.title}</h1>
          {view.kind === "list" && <p className="text-sm text-gray-500">{t.subtitle}</p>}
        </div>
      </header>

      {list && !list.configured ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-3 text-sm text-amber-900">{t.notConfigured}</p>
      ) : (
        <>
          <StatusLight online={online} t={t} />

          {view.kind === "list" && (
            <>
              <section aria-label={t.pickIssue} className="rounded-2xl border border-gray-200 bg-white p-3">
                <h2 className="mb-2 text-sm font-medium text-gray-700">{t.pickIssue}</h2>
                <div role="tablist" className="mb-2.5 grid grid-cols-2 gap-2">
                  {ISSUE_KINDS.map((k) => {
                    const n = (logged ?? []).filter((i) => issueKind(i.category) === k).length;
                    return (
                      <button
                        key={k} type="button" role="tab" aria-selected={kind === k}
                        onClick={() => { setKind(k); setShown(PICK_STEP); }}
                        className={`min-h-12 rounded-xl border px-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
                          kind === k ? "border-blue-600 bg-blue-600 text-white" : "border-gray-300 bg-white text-gray-700 hover:border-blue-400"
                        }`}
                      >
                        {t.kinds[k]}{logged ? <span className="ms-1.5 tabular-nums opacity-80">{n}</span> : null}
                      </button>
                    );
                  })}
                </div>
                {!logged && !loggedErr && <div className="py-4"><Spinner text={t.pickIssue} /></div>}
                {loggedErr && !logged && (
                  <p role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
                    {t.issuesFailed}
                    <Btn variant="outline" onClick={() => { setLoggedErr(false); void loadLogged(); }}><RotateCw size={14} /> {t.reload}</Btn>
                  </p>
                )}
                {logged && (() => {
                  const ofKind = logged.filter((i) => issueKind(i.category) === kind);
                  if (ofKind.length === 0) return <p className="py-3 text-center text-sm text-gray-500">{t.noIssues}</p>;
                  return (
                    <>
                      <ul className="space-y-2">
                        {ofKind.slice(0, shown).map((i) => (
                          <li key={i.row}>
                            <button
                              type="button"
                              onClick={() => go({ kind: "new", issue: {
                                row: i.row, date: i.date, machine: i.machine, product: i.product, category: i.category,
                                description: i.description, action: i.action, status: i.status, note: i.note,
                              } })}
                              className="block min-h-14 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-start hover:border-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                            >
                              <span className="flex items-start justify-between gap-2">
                                <span className="min-w-0 break-words font-medium text-gray-900">
                                  {kind === "machine"
                                    ? (i.machine ? <bdi dir="ltr">{i.machine}</bdi> : i.product || "—")
                                    : (i.product || (i.machine ? <bdi dir="ltr">{i.machine}</bdi> : "—"))}
                                </span>
                                <span className="shrink-0 text-xs tabular-nums text-gray-500">{formatDate(i.date, isAr ? "ar" : "en") || i.date}</span>
                              </span>
                              <span className="mt-0.5 block truncate text-sm text-gray-600" dir="auto">
                                {kind === "machine" && i.machine && i.product ? `${i.product} · ` : ""}
                                {i.description || (i.issueAudio ? t.voiceOnly : "—")}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                      {ofKind.length > shown && (
                        <Btn variant="ghost" onClick={() => setShown((n) => n + PICK_STEP)} className="mt-1 w-full">{t.showMore}</Btn>
                      )}
                    </>
                  );
                })()}
              </section>

              <Btn onClick={() => go({ kind: "new", issue: null })} className="min-h-14 w-full text-base">
                <Plus size={20} /> {t.general}
              </Btn>
              {capLine && <p className="text-center text-xs text-gray-500">{capLine}</p>}
              {listErr && (
                <p role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
                  {listErr}
                  <Btn variant="outline" onClick={() => void loadList()}><RotateCw size={14} /> {t.reload}</Btn>
                </p>
              )}
              <h2 className="pt-2 text-sm font-medium text-gray-600">{t.myThreads}</h2>
              {list && list.threads.length === 0 ? (
                <EmptyState text={t.noThreads} sub={t.noThreadsSub} />
              ) : (
                <ul className="space-y-2">
                  {list?.threads.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button" onClick={() => go({ kind: "thread", id: r.id })}
                        className="block min-h-16 w-full rounded-xl border border-gray-200 bg-white px-3.5 py-3 text-start hover:border-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                      >
                        <span className="flex items-start justify-between gap-2">
                          <span className="min-w-0 break-words font-medium text-gray-900">{r.title || "—"}</span>
                          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            r.status === "answered" ? "bg-green-50 text-green-700"
                              : r.status === "failed" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"
                          }`}>{t.status[r.status]}</span>
                        </span>
                        {r.last && <span className="mt-1 block truncate text-sm text-gray-500" dir="auto">{r.last.text}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {view.kind === "new" && (
            <>
              {view.issue && <IssueCard issue={view.issue} t={t} isAr={isAr} />}
              <Advice t={t} />
              {capLine && <p className="text-center text-xs text-gray-500">{capLine}</p>}
              <Composer
                t={t} placeholder={t.placeholder} busy={busy} disabled={capBlocked} error={sendErr}
                onSend={(text, photo) => post("/api/ask", { text, photo: photo?.base64, issue: view.issue })}
              />
            </>
          )}

          {view.kind === "thread" && (
            <>
              {!thread && !threadErr && <div className="py-10"><Spinner text={t.title} /></div>}
              {threadErr && (
                <p role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
                  {threadErr}
                  <Btn variant="outline" onClick={() => void loadThread(view.id)}><RotateCw size={14} /> {t.reload}</Btn>
                </p>
              )}
              {thread && (
                <>
                  {thread.issue && <IssueCard issue={thread.issue} t={t} isAr={isAr} verified={thread.issue.verified} />}
                  <ol className="space-y-3">
                    {thread.messages.map((m) => (
                      <li key={m.id} className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}>
                        <div className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 ${
                          m.role === "user" ? "bg-blue-600 text-white" : "border border-gray-200 bg-white text-gray-900"
                        }`}>
                          <p className={`mb-1 text-xs ${m.role === "user" ? "text-blue-100" : "text-gray-500"}`}>
                            {m.role === "user" ? t.you : t.claude} · {clock(m.at)}
                          </p>
                          {m.photoId && <div className="mb-2"><StoredPhoto threadId={thread.id} photoId={m.photoId} alt={t.photoAlt} /></div>}
                          {m.text && <p dir="auto" className="whitespace-pre-wrap break-words text-base leading-relaxed">{m.text}</p>}
                        </div>
                      </li>
                    ))}
                  </ol>

                  {waiting && (
                    <div role="status" className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-white px-3.5 py-3">
                      <span className="mt-1 flex gap-1" aria-hidden>
                        {[0, 1, 2].map((i) => (
                          <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: `${i * 150}ms` }} />
                        ))}
                      </span>
                      <span className="text-sm text-gray-700">
                        {online ? t.thinking : t.waitingOffline}
                        {/* Only once it HAS been long, or the laptop is off. */}
                        {(!online || longWait) && (
                          <span className="mt-0.5 block text-xs text-gray-500">{t.waitLong}</span>
                        )}
                      </span>
                    </div>
                  )}

                  {thread.status === "failed" && (
                    <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-900">
                      <p className="font-medium">{t.failed}</p>
                      {thread.failure?.reason && <p dir="auto" className="mt-1 break-words text-red-800">{thread.failure.reason}</p>}
                      {mine && <Btn
                        onClick={() => void post(`/api/ask/${encodeURIComponent(thread.id)}`, { retry: true })}
                        disabled={busy} className="mt-2.5 min-h-12 w-full"
                      >
                        <RotateCw size={16} /> {busy ? t.retrying : t.retry}
                      </Btn>}
                      {sendErr && <p className="mt-2">{sendErr}</p>}
                    </div>
                  )}

                  <Advice t={t} />

                  {thread.status === "answered" && mine && (
                    <>
                      {capLine && <p className="text-center text-xs text-gray-500">{capLine}</p>}
                      <Composer
                        t={t} placeholder={t.placeholderFollow} busy={busy} disabled={capBlocked} error={sendErr}
                        onSend={(text, photo) => post(`/api/ask/${encodeURIComponent(thread.id)}`, { text, photo: photo?.base64 })}
                      />
                    </>
                  )}
                  <div ref={bottom} />
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
