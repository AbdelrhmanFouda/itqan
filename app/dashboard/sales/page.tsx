"use client";
import { useEffect, useState } from "react";
import { useLang } from "@/context/LangContext";
import { ad } from "@/lib/i18n.auth";
import { pd } from "@/lib/i18n.prod";
import { JOB_STATUSES, jobTone, localize } from "@/lib/prod-meta";
import { Pill, Spinner, EmptyState } from "@/components/dashboard/ui";

type Inquiry = {
  id: string; name: string; company: string; phone: string;
  email: string; inquiryType: string; message: string; createdAt: number;
};
type Job = {
  id: string; code: string; client: string; partName: string;
  qtyOrdered: number; dueDate: string; status: string;
};
type Run = { jobId: string; goodUnits: number };

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
      fetch("/api/inquiries").then((r) => r.json()),
      fetch("/api/jobs").then((r) => r.json()),
      fetch("/api/runs").then((r) => r.json()),
    ])
      .then(([i, j, runs]) => {
        setInquiries(i);
        setJobs(j);
        const by: Record<string, number> = {};
        for (const r of runs as Run[]) by[r.jobId] = (by[r.jobId] ?? 0) + (r.goodUnits || 0);
        setProduced(by);
      })
      .catch(() => setInquiries([]));
  }, []);

  const fmt = (n: number) => Number(n || 0).toLocaleString(isAr ? "ar-EG" : "en-US");
  const recv = (ms: number) => (ms ? new Date(ms).toLocaleDateString(isAr ? "ar-EG" : "en-US") : "—");

  if (inquiries === null) return <Spinner text={a.sales.title} />;

  const openJobs = jobs.filter((j) => !DONE.includes(j.status));
  const byClient: Record<string, Job[]> = {};
  for (const j of openJobs) {
    if (!byClient[j.client]) byClient[j.client] = [];
    byClient[j.client].push(j);
  }
  const clients = Object.keys(byClient).sort();

  return (
    <div className="max-w-5xl" dir={isAr ? "rtl" : "ltr"}>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">{a.sales.title}</h1>
      <p className="text-sm text-gray-500 mb-8">{a.sales.subtitle}</p>

      {/* Incoming inquiries */}
      <h2 className="font-semibold text-gray-900 mb-3">{a.sales.inquiries}</h2>
      {inquiries.length === 0 ? (
        <EmptyState text={a.sales.noInquiries} />
      ) : (
        <div className="grid sm:grid-cols-2 gap-4 mb-10">
          {inquiries.map((q) => (
            <div key={q.id} className="bg-white border border-gray-200 rounded-xl p-5">
              <div className={`flex items-start justify-between gap-3 ${isAr ? "flex-row-reverse" : ""}`}>
                <div className={isAr ? "text-right" : ""}>
                  <p className="font-semibold text-gray-900">{q.company || q.name || "—"}</p>
                  <p className="text-xs text-gray-500">{q.name}{q.email ? ` · ${q.email}` : ""}{q.phone ? ` · ${q.phone}` : ""}</p>
                </div>
                {q.inquiryType ? (
                  <span className="text-xs px-2.5 py-1 rounded-full border border-blue-200 bg-blue-50 text-blue-700 whitespace-nowrap shrink-0">
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
      <h2 className="font-semibold text-gray-900 mb-3">{a.sales.demand}</h2>
      {clients.length === 0 ? (
        <EmptyState text={a.sales.noOrders} />
      ) : (
        <div className="space-y-5">
          {clients.map((client) => (
            <div key={client} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className={`px-5 py-3 border-b border-gray-100 font-semibold text-gray-900 ${isAr ? "text-right" : ""}`}>
                {client}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" dir={isAr ? "rtl" : "ltr"}>
                  <thead>
                    <tr className="text-gray-500 border-b border-gray-100 text-xs uppercase tracking-wide">
                      <th className="text-start font-medium px-5 py-2.5">{p.jobs.code}</th>
                      <th className="text-start font-medium px-5 py-2.5">{p.jobs.part}</th>
                      <th className="text-start font-medium px-5 py-2.5">{a.sales.ordered}</th>
                      <th className="text-start font-medium px-5 py-2.5">{a.sales.produced}</th>
                      <th className="text-start font-medium px-5 py-2.5">{a.sales.remaining}</th>
                      <th className="text-start font-medium px-5 py-2.5">{a.sales.due}</th>
                      <th className="text-start font-medium px-5 py-2.5">{a.sales.status}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {byClient[client].map((j) => {
                      const made = produced[j.id] ?? 0;
                      const remaining = Math.max(0, (Number(j.qtyOrdered) || 0) - made);
                      return (
                        <tr key={j.id} className="hover:bg-gray-50/60">
                          <td className="px-5 py-2.5 font-medium text-gray-900">{j.code}</td>
                          <td className="px-5 py-2.5 text-gray-600">{j.partName}</td>
                          <td className="px-5 py-2.5 text-gray-700">{fmt(Number(j.qtyOrdered) || 0)}</td>
                          <td className="px-5 py-2.5 text-green-600">{fmt(made)}</td>
                          <td className="px-5 py-2.5 text-gray-700">{fmt(remaining)}</td>
                          <td className="px-5 py-2.5 text-gray-500 whitespace-nowrap">{j.dueDate || "—"}</td>
                          <td className="px-5 py-2.5">
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
