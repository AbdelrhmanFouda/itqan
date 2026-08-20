"use client";
import { useEffect, useState } from "react";
import { useLang } from "@/context/LangContext";
import { ad } from "@/lib/i18n.auth";
import { pd } from "@/lib/i18n.prod";
import { JOB_STATUSES, jobTone, localize } from "@/lib/prod-meta";
import { Pill, Spinner, EmptyState } from "@/components/dashboard/ui";
import { authedFetch } from "@/lib/authed-fetch";

type Inquiry = {
  id: string; name: string; company: string; phone: string;
  email: string; inquiryType: string; message: string; createdAt: number;
};
type Job = {
  id: string; code: string; client: string; product: string;
  qtyOrdered: number; dueDate: string; status: string; produced: number;
};

const DONE = ["Completed", "Delivered"];

export default function SalesPage() {
  const { lang } = useLang();
  const a = ad[lang];
  const p = pd[lang];
  const isAr = lang === "ar";

  const [inquiries, setInquiries] = useState<Inquiry[] | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [produced, setProduced] = useState<Record<string, number>>({});

  useEffect(() => {
    Promise.all([
      authedFetch("/api/inquiries").then((r) => r.json()),
      fetch("/api/jobs").then((r) => r.json()),
    ])
      .then(([i, j]) => {
        setInquiries(Array.isArray(i) ? i : []);
        const list: Job[] = j.jobs ?? [];
        setJobs(list);
        const by: Record<string, number> = {};
        for (const jb of list) by[jb.id] = jb.produced || 0;
        setProduced(by);
      })
      .catch(() => setInquiries([]));
  }, []);

  const fmt = (n: number) => Number(n || 0).toLocaleString(isAr ? "ar-EG" : "en-US");
  const recv = (ms: number) => (ms ? new Date(ms).toLocaleDateString(isAr ? "ar-EG" : "en-US") : "—");

  if (inquiries === null) return <div className="flex justify-center py-16"><Spinner text={p.common.loading} /></div>;

  const openJobs = jobs.filter((j) => !DONE.includes(j.status));
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

      {/* Incoming inquiries */}
      <h2 className="text-sm font-semibold text-gray-900 mb-3">{a.sales.inquiries}</h2>
      {inquiries.length === 0 ? (
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
              <p className="text-xs text-gray-400 mt-3">{a.sales.received}: {recv(q.createdAt)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Open orders by customer */}
      <h2 className="text-sm font-semibold text-gray-900 mb-3">{a.sales.demand}</h2>
      {clients.length === 0 ? (
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
