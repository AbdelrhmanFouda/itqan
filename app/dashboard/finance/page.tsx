"use client";
import { useEffect, useState } from "react";
import { useLang } from "@/context/LangContext";
import { ad } from "@/lib/i18n.auth";
import { Stat, Spinner, EmptyState } from "@/components/dashboard/ui";

type Job = { id: string; client: string; status: string; dueDate: string; produced: number };
type Run = { machine: string; date: string; goodUnits: number; scrapUnits: number; downtimeMin: number };

const DONE = ["Completed", "Delivered"];

function Bars({
  data, isAr, unit, percent, empty,
}: {
  data: { label: string; value: number }[];
  isAr: boolean;
  unit?: string;
  percent?: boolean;
  empty: string;
}) {
  const fmt = (n: number) => Number(n || 0).toLocaleString(isAr ? "ar-EG" : "en-US");
  if (data.length === 0) return <EmptyState text={empty} />;
  const max = data.reduce((m, d) => Math.max(m, d.value), 0);
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
      {data.map((d) => (
        <div key={d.label}>
          <div className={`flex justify-between text-sm mb-1 ${isAr ? "flex-row-reverse" : ""}`}>
            <span className="font-medium text-gray-800">{d.label}</span>
            <span className="text-gray-500">{percent ? `${d.value}%` : `${fmt(d.value)}${unit ? ` ${unit}` : ""}`}</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full" style={{ width: `${max ? (d.value / max) * 100 : 0}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function FinancePage() {
  const { lang } = useLang();
  const a = ad[lang];
  const isAr = lang === "ar";
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);

  useEffect(() => {
    Promise.all([
      fetch("/api/jobs").then((r) => r.json()),
      fetch("/api/runs").then((r) => r.json()),
    ])
      .then(([j, r]) => { setJobs(j.jobs ?? []); setRuns(Array.isArray(r) ? r : []); })
      .catch(() => setJobs([]));
  }, []);

  const fmt = (n: number) => Number(n || 0).toLocaleString(isAr ? "ar-EG" : "en-US");

  if (jobs === null) return <Spinner text={a.finance.title} />;

  const today = new Date().toISOString().slice(0, 10);
  const ym = today.slice(0, 7);
  const monthRuns = runs.filter((r) => (r.date || "").startsWith(ym));
  const goodAll = runs.reduce((s, r) => s + (r.goodUnits || 0), 0);
  const goodMonth = monthRuns.reduce((s, r) => s + (r.goodUnits || 0), 0);
  const scrapMonth = monthRuns.reduce((s, r) => s + (r.scrapUnits || 0), 0);
  const downtimeMonth = monthRuns.reduce((s, r) => s + (r.downtimeMin || 0), 0);
  const scrapRate = goodMonth + scrapMonth ? ((scrapMonth / (goodMonth + scrapMonth)) * 100).toFixed(1) : "0.0";
  const activeJobs = jobs.filter((j) => j.status === "In Production").length;
  const overdue = jobs.filter((j) => !DONE.includes(j.status) && j.dueDate && j.dueDate < today).length;

  // by month
  const monthMap: Record<string, { good: number; scrap: number }> = {};
  for (const r of runs) {
    const k = (r.date || "").slice(0, 7);
    if (!k) continue;
    if (!monthMap[k]) monthMap[k] = { good: 0, scrap: 0 };
    monthMap[k].good += r.goodUnits || 0;
    monthMap[k].scrap += r.scrapUnits || 0;
  }
  const months = Object.keys(monthMap).sort().slice(-6);
  const goodByMonth = months.map((k) => ({ label: k, value: monthMap[k].good }));
  const scrapByMonth = months.map((k) => {
    const tot = monthMap[k].good + monthMap[k].scrap;
    return { label: k, value: tot ? Number(((monthMap[k].scrap / tot) * 100).toFixed(1)) : 0 };
  });

  // produced per job (computed by the API) → by client / by machine
  const clientMap: Record<string, number> = {};
  for (const j of jobs) {
    const v = j.produced || 0;
    if (v && j.client) clientMap[j.client] = (clientMap[j.client] ?? 0) + v;
  }
  const byClient = Object.entries(clientMap).map(([label, value]) => ({ label, value })).sort((x, y) => y.value - x.value).slice(0, 6);

  const machMap: Record<string, number> = {};
  for (const r of runs) {
    const key = r.machine || "—";
    machMap[key] = (machMap[key] ?? 0) + (r.goodUnits || 0);
  }
  const byMachine = Object.entries(machMap).map(([label, value]) => ({ label, value })).sort((x, y) => y.value - x.value).slice(0, 6);

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">{a.finance.title}</h1>
      <p className="text-sm text-gray-500 mb-5">{a.finance.subtitle}</p>

      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-sm text-blue-800 mb-8">
        {a.finance.note}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <Stat label={a.finance.goodAll} value={fmt(goodAll)} />
        <Stat label={a.finance.goodMonth} value={fmt(goodMonth)} />
        <Stat label={a.finance.scrapRate} value={`${scrapRate}%`} tone={Number(scrapRate) > 3 ? "amber" : undefined} />
        <Stat label={a.finance.downtime} value={`${fmt(downtimeMonth)} ${a.finance.min}`} />
        <Stat label={a.finance.activeJobs} value={activeJobs} />
        <Stat label={a.finance.overdue} value={overdue} tone={overdue > 0 ? "red" : undefined} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div>
          <h2 className="font-semibold text-gray-900 mb-3">{a.finance.byMonth}</h2>
          <Bars data={goodByMonth} isAr={isAr} unit={a.finance.units} empty={a.finance.noData} />
        </div>
        <div>
          <h2 className="font-semibold text-gray-900 mb-3">{a.finance.scrapByMonth}</h2>
          <Bars data={scrapByMonth} isAr={isAr} percent empty={a.finance.noData} />
        </div>
        <div>
          <h2 className="font-semibold text-gray-900 mb-3">{a.finance.byClient}</h2>
          <Bars data={byClient} isAr={isAr} unit={a.finance.units} empty={a.finance.noData} />
        </div>
        <div>
          <h2 className="font-semibold text-gray-900 mb-3">{a.finance.byMachine}</h2>
          <Bars data={byMachine} isAr={isAr} unit={a.finance.units} empty={a.finance.noData} />
        </div>
      </div>
    </div>
  );
}
