"use client";
import { usePageTitle } from "@/components/dashboard/use-page-title";
/**
 * Sales reads the inquiries (Firestore, fast) and the order book
 * («أوامر العمل» through /api/jobs — four sheet tabs, seconds on a cold
 * instance). Same pattern as /dashboard/jobs and /dashboard/stock:
 *
 *  - the last answer THIS DEVICE saw paints at once (`itqan.sales.last`);
 *  - both fetches are bounded (`timedJson`), so a stalled bridge becomes a
 *    line with a retry instead of a spinner that runs until the platform
 *    kills the function;
 *  - the two sections are independent — the inquiries render without waiting
 *    for the sheet, and a section whose source has not landed says so rather
 *    than claiming «no inquiries» / «no orders»;
 *  - a failed refresh never replaces what is on screen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "@/context/LangContext";
import { ad } from "@/lib/i18n.auth";
import { pd } from "@/lib/i18n.prod";
import { JOB_STATUSES, jobTone, localize } from "@/lib/prod-meta";
import { Pill, Spinner, EmptyState, LoadError } from "@/components/dashboard/ui";
import { authedFetch } from "@/lib/authed-fetch";
import { readLastSeen, timedJson, writeLastSeen } from "@/components/dashboard/last-seen";
import { fmtNum, numLocale } from "@/lib/format";

type Inquiry = {
  id: string; name: string; company: string; phone: string;
  email: string; inquiryType: string; message: string; source: string; createdAt: number;
};
type Job = {
  id: string; code: string; client: string; product: string;
  qtyOrdered: number; dueDate: string; status: string; produced: number;
};

/** What the device remembers between visits — both halves, in one object. */
type Snap = { inquiries: Inquiry[]; jobs: Job[] };

const DONE = ["Completed", "Delivered"];
const LAST_KEY = "itqan.sales.last";

export default function SalesPage() {
  const { lang } = useLang();
  const a = ad[lang];
  const p = pd[lang];
  const isAr = lang === "ar";
  usePageTitle(a.sales.title);

  // null = that source has not answered yet. An empty array is an ANSWER.
  const [inquiries, setInquiries] = useState<Inquiry[] | null>(null);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<{ timedOut: boolean } | null>(null);
  /** Everything on screen came off this device, not off a live answer. */
  const [fromSnapshot, setFromSnapshot] = useState(false);

  // The last GOOD value of each half, so a snapshot write never drops the half
  // that did not refresh this time.
  const seen = useRef<Snap>({ inquiries: [], jobs: [] });

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(null);
    // Both go out at once and each paints on its own: the inquiries (Firestore,
    // fast) never wait behind the four sheet tabs of /api/jobs.
    const ip = timedJson<Inquiry[]>(authedFetch, "/api/inquiries");
    const jp = timedJson<{ jobs?: Job[] }>(authedFetch, "/api/jobs");
    void ip.then((res) => {
      if (!res.ok) return; // a failure must never blank what is already shown
      const list = Array.isArray(res.data) ? res.data : [];
      seen.current = { ...seen.current, inquiries: list };
      setInquiries(list);
      setFromSnapshot(false);
    });
    void jp.then((res) => {
      if (!res.ok) return;
      const list = res.data.jobs ?? [];
      seen.current = { ...seen.current, jobs: list };
      setJobs(list);
      setFromSnapshot(false);
    });
    const [i, j] = await Promise.all([ip, jp]);
    if (i.ok || j.ok) writeLastSeen(LAST_KEY, seen.current);
    const bad = !i.ok ? i : !j.ok ? j : null;
    setFailed(bad ? { timedOut: bad.timedOut } : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    // What this device saw last time renders AT ONCE; the live answer replaces
    // it. A phone opening the page cold used to watch a spinner for the whole
    // bridge round trip.
    const snap = readLastSeen<Snap>(LAST_KEY);
    if (snap && Array.isArray(snap.inquiries) && Array.isArray(snap.jobs)) {
      seen.current = { inquiries: snap.inquiries, jobs: snap.jobs };
      setInquiries(snap.inquiries);
      setJobs(snap.jobs);
      setFromSnapshot(true);
    }
    load();
  }, [load]);

  const fmt = (n: number) => fmtNum(n, isAr);
  const recv = (ms: number) => (ms ? new Date(ms).toLocaleDateString(numLocale(isAr)) : "—");
  const produced = useMemo(() => {
    const by: Record<string, number> = {};
    for (const jb of jobs ?? []) by[jb.id] = jb.produced || 0;
    return by;
  }, [jobs]);

  // Nothing at all on screen: the existing error state, now with a retry.
  if (failed && inquiries === null && jobs === null) {
    return (
      <div className="max-w-5xl" dir={isAr ? "rtl" : "ltr"}>
        <h1 className="text-2xl font-bold text-gray-900 mb-4">{a.sales.title}</h1>
        <LoadError
          variant="empty"
          text={failed.timedOut ? p.common.timedOut : p.common.loadError}
          retry={p.common.retry}
          onRetry={load}
        />
      </div>
    );
  }
  if (inquiries === null && jobs === null) return <div className="flex justify-center py-16"><Spinner text={p.common.loading} /></div>;

  const openJobs = (jobs ?? []).filter((j) => !DONE.includes(j.status));
  const byClient: Record<string, Job[]> = {};
  for (const j of openJobs) {
    if (!byClient[j.client]) byClient[j.client] = [];
    byClient[j.client].push(j);
  }
  const clients = Object.keys(byClient).sort();

  return (
    <div className="max-w-5xl" dir={isAr ? "rtl" : "ltr"}>
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">{a.sales.title}</h1>
        <p className="text-sm text-gray-500">{a.sales.subtitle}</p>
      </div>

      {/* A refresh that failed keeps what is on screen and says so — it never
          blanks the page, and it never leaves an endless spinner. */}
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

      {/* Incoming inquiries */}
      <h2 className="text-sm font-semibold text-gray-900 mb-3">{a.sales.inquiries}</h2>
      {inquiries === null ? (
        // Not «no inquiries» — that source simply has not answered yet.
        <div className="flex justify-center"><Spinner text={p.common.loading} /></div>
      ) : inquiries.length === 0 ? (
        <EmptyState text={a.sales.noInquiries} />
      ) : (
        <div className="grid sm:grid-cols-2 gap-4 mb-8 sm:mb-10">
          {inquiries.map((q) => (
            <div key={q.id} className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3 min-w-0">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900">{q.company || q.name || "—"}</p>
                  <p className="text-xs text-gray-500 break-words [overflow-wrap:anywhere]">{q.name}{q.email ? ` · ${q.email}` : ""}{q.phone ? ` · ${q.phone}` : ""}</p>
                </div>
                {q.inquiryType ? (
                  <span className="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full border border-blue-200 bg-blue-50 text-blue-700 whitespace-nowrap shrink-0">
                    {q.inquiryType}
                  </span>
                ) : null}
              </div>
              {q.message ? <p className="text-sm text-gray-600 mt-3 leading-relaxed">{q.message}</p> : null}
              <p className="text-xs text-gray-400 mt-3">
                {a.sales.received}: {recv(q.createdAt)}
                {/* utm/referrer attribution, when the visit carried one */}
                {q.source ? <span className="break-all [overflow-wrap:anywhere]" dir="ltr"> · {q.source}</span> : null}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Open orders by customer */}
      <h2 className="text-sm font-semibold text-gray-900 mb-3">{a.sales.demand}</h2>
      {jobs === null ? (
        // Not «no orders» — «أوامر العمل» simply has not answered yet.
        <div className="flex justify-center"><Spinner text={p.common.loading} /></div>
      ) : clients.length === 0 ? (
        <EmptyState text={a.sales.noOrders} />
      ) : (
        <div className="space-y-5">
          {clients.map((client) => (
            <div key={client} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-4 sm:px-5 py-3 border-b border-gray-100 font-semibold text-gray-900">
                {client}
              </div>
              {/* Phone: one card per order. Seven columns cannot be read at
                  375px, and the two numbers that matter (remaining, due) are
                  the ones furthest right — i.e. the first to scroll away. */}
              <div className="sm:hidden divide-y divide-gray-100">
                {byClient[client].map((j) => {
                  const made = produced[j.id] ?? 0;
                  const remaining = Math.max(0, (Number(j.qtyOrdered) || 0) - made);
                  return (
                    <div key={j.id} className="px-4 py-3 space-y-1.5">
                      <div className="flex items-start justify-between gap-3 min-w-0">
                        <div className="min-w-0">
                          <div className="font-medium text-gray-900 truncate">{j.code}</div>
                          <div className="text-xs text-gray-500 truncate">{j.product}</div>
                        </div>
                        <span className="shrink-0">
                          <Pill text={localize(j.status, JOB_STATUSES, p.jobs.statuses)} tone={jobTone(j.status)} />
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                        <span className="text-gray-700 tabular-nums">{a.sales.ordered}: {fmt(Number(j.qtyOrdered) || 0)}</span>
                        <span className="text-green-600 tabular-nums">{a.sales.produced}: {fmt(made)}</span>
                        <span className="text-gray-900 font-medium tabular-nums">{a.sales.remaining}: {fmt(remaining)}</span>
                      </div>
                      <div className="text-xs text-gray-500 tabular-nums">{a.sales.due}: {j.dueDate || "—"}</div>
                    </div>
                  );
                })}
              </div>

              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50/50">
                      <th className="text-start px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{p.jobs.code}</th>
                      <th className="text-start px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{p.jobs.part}</th>
                      <th className="text-end px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{a.sales.ordered}</th>
                      <th className="text-end px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{a.sales.produced}</th>
                      <th className="text-end px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{a.sales.remaining}</th>
                      <th className="text-start px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{a.sales.due}</th>
                      <th className="text-start px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{a.sales.status}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {byClient[client].map((j) => {
                      const made = produced[j.id] ?? 0;
                      const remaining = Math.max(0, (Number(j.qtyOrdered) || 0) - made);
                      return (
                        <tr key={j.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="px-4 py-3 font-medium text-gray-900">{j.code}</td>
                          <td className="px-4 py-3 text-gray-600">{j.product}</td>
                          <td className="px-4 py-3 text-gray-700 text-end tabular-nums">{fmt(Number(j.qtyOrdered) || 0)}</td>
                          <td className="px-4 py-3 text-green-600 text-end tabular-nums">{fmt(made)}</td>
                          <td className="px-4 py-3 text-gray-700 text-end tabular-nums">{fmt(remaining)}</td>
                          <td className="px-4 py-3 text-gray-500 whitespace-nowrap tabular-nums">{j.dueDate || "—"}</td>
                          <td className="px-4 py-3">
                            <Pill text={localize(j.status, JOB_STATUSES, p.jobs.statuses)} tone={jobTone(j.status)} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
