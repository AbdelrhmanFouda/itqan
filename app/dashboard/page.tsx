"use client";
import { useLang } from "@/context/LangContext";
import { pd } from "@/lib/i18n.prod";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, BarChart3 } from "lucide-react";
import { Stat, EmptyState } from "@/components/dashboard/ui";

type Machine = { name: string; status: string };
type Job = { id: string; code: string; status: string; dueDate: string };
type Run = {
  id: string;
  machine: string;
  mold: string;
  product: string;
  date: string;
  goodUnits: number;
  scrapUnits: number;
  downtimeMin: number;
};

const OPERATIONAL = ["Operational", "تعمل", "Active"];
const DONE = ["Completed", "Delivered"];

export default function DashboardPage() {
  const { lang } = useLang();
  const p = pd[lang];
  const isAr = lang === "ar";

  const [machines, setMachines] = useState<Machine[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);

  useEffect(() => {
    fetch("/api/machines").then((r) => r.json()).then((m) => setMachines(m.machines ?? [])).catch(() => {});
    fetch("/api/jobs").then((r) => r.json()).then((j) => setJobs(j.jobs ?? [])).catch(() => {});
    fetch("/api/runs").then((r) => r.json()).then((r) => setRuns(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const ym = today.slice(0, 7);

  const operational = machines.filter((m) => OPERATIONAL.includes(m.status)).length;
  const activeJobs = jobs.filter((j) => j.status === "In Production").length;
  const overdue = jobs.filter(
    (j) => !DONE.includes(j.status) && j.dueDate && j.dueDate < today
  ).length;

  const monthRuns = runs.filter((r) => (r.date || "").startsWith(ym));
  const good = monthRuns.reduce((s, r) => s + (r.goodUnits || 0), 0);
  const scrap = monthRuns.reduce((s, r) => s + (r.scrapUnits || 0), 0);
  const downtime = monthRuns.reduce((s, r) => s + (r.downtimeMin || 0), 0);
  const scrapRate = good + scrap ? ((scrap / (good + scrap)) * 100).toFixed(1) : "0.0";

  // Top machines this month by good units
  const byMachine: Record<string, number> = {};
  for (const r of monthRuns) {
    const key = r.machine || "—";
    byMachine[key] = (byMachine[key] ?? 0) + (r.goodUnits || 0);
  }
  const topMachines = Object.entries(byMachine)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const topMax = topMachines.length ? topMachines[0][1] : 0;

  const recent = runs.slice(0, 6);
  const fmt = (n: number) => n.toLocaleString(isAr ? "ar-EG" : "en-US");

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">{p.overview.title}</h1>
      <p className="text-sm text-gray-500 mb-8">{p.overview.subtitle}</p>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <Stat
          label={p.overview.operationalMachines}
          value={operational}
          sub={`${p.overview.ofTotal} ${machines.length}`}
        />
        <Stat label={p.overview.activeJobs} value={activeJobs} />
        <Stat
          label={p.overview.overdueJobs}
          value={overdue}
          tone={overdue > 0 ? "red" : undefined}
        />
        <Stat label={p.overview.unitsThisMonth} value={fmt(good)} />
        <Stat
          label={p.overview.scrapThisMonth}
          value={`${scrapRate}%`}
          tone={Number(scrapRate) > 3 ? "amber" : undefined}
        />
        <Stat label={p.overview.downtimeThisMonth} value={`${fmt(downtime)} ${p.overview.minutes}`} />
      </div>

      <div className="flex gap-3 mb-10">
        <Link
          href="/dashboard/production"
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded-lg font-medium transition-colors"
        >
          <Plus size={15} /> {p.overview.logProduction}
        </Link>
        <Link
          href="/dashboard/jobs"
          className="flex items-center gap-1.5 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm px-4 py-2 rounded-lg font-medium transition-colors"
        >
          <Plus size={15} /> {p.overview.newJob}
        </Link>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Top machines */}
        <div>
          <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <BarChart3 size={16} className="text-blue-600" />
            {p.overview.topMachines}
          </h2>
          {topMachines.length === 0 ? (
            <EmptyState text={p.overview.noData} />
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
              {topMachines.map(([mid, units]) => (
                <div key={mid}>
                  <div className={`flex justify-between text-sm mb-1 ${isAr ? "flex-row-reverse" : ""}`}>
                    <span className="font-medium text-gray-800">{mid}</span>
                    <span className="text-gray-500">{fmt(units)} {p.overview.units}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full"
                      style={{ width: `${topMax ? (units / topMax) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent production */}
        <div>
          <h2 className="font-semibold text-gray-900 mb-3">{p.overview.recentRuns}</h2>
          {recent.length === 0 ? (
            <EmptyState text={p.overview.noData} />
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
              {recent.map((r) => (
                <div key={r.id} className={`px-5 py-3 flex items-center justify-between text-sm ${isAr ? "flex-row-reverse" : ""}`}>
                  <div dir={isAr ? "rtl" : "ltr"}>
                    <span className="font-medium text-gray-800">{r.product || r.mold || "—"}</span>
                    <span className="text-gray-400"> · {r.machine || "—"}</span>
                  </div>
                  <div className={`text-gray-500 ${isAr ? "text-left" : "text-right"}`}>
                    <span className="text-green-600 font-medium">{fmt(r.goodUnits)}</span>
                    {r.scrapUnits > 0 && <span className="text-red-500"> / {fmt(r.scrapUnits)}</span>}
                    <span className="text-gray-400 text-xs block">{r.date}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
