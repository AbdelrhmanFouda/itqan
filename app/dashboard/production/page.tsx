"use client";
import { useLang } from "@/context/LangContext";
import { pd } from "@/lib/i18n.prod";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { Stat, Field, inputCls, Btn, Modal, EmptyState, Spinner } from "@/components/dashboard/ui";
import { DOWNTIME_REASONS, localize, options } from "@/lib/prod-meta";

type Run = {
  id: string; jobId: string; machineId: string; date: string;
  goodUnits: number; scrapUnits: number; downtimeMin: number;
  downtimeReason: string; operator: string; note: string;
};
type Job = { id: string; code: string; machineId: string };
type Machine = { id: string; name: string };

export default function ProductionPage() {
  const { lang } = useLang();
  const p = pd[lang];
  const isAr = lang === "ar";

  const [runs, setRuns] = useState<Run[] | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [period, setPeriod] = useState<"month" | "all">("month");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const ym = today.slice(0, 7);

  const blank = useCallback(
    () => ({
      date: today, jobId: "", machineId: "", goodUnits: "", scrapUnits: "",
      downtimeMin: "", downtimeReason: "None", operator: "", note: "",
    }),
    [today]
  );
  const [form, setForm] = useState(blank());

  const load = useCallback(async () => {
    const [r, j, m] = await Promise.all([
      fetch("/api/runs").then((x) => x.json()),
      fetch("/api/jobs").then((x) => x.json()),
      fetch("/api/machines").then((x) => x.json()),
    ]);
    setRuns(r); setJobs(j); setMachines(m);
  }, []);
  useEffect(() => { load(); }, [load]);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => {
      const next = { ...f, [k]: v };
      // When a job is picked, default the machine to that job's machine.
      if (k === "jobId" && !f.machineId) {
        const job = jobs.find((x) => x.id === v);
        if (job?.machineId) next.machineId = job.machineId;
      }
      return next;
    });
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setForm(blank());
    setOpen(false);
    setSaving(false);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm(p.common.confirmDelete)) return;
    await fetch(`/api/runs/${id}`, { method: "DELETE" });
    load();
  }

  const fmt = (n: number) => Number(n || 0).toLocaleString(isAr ? "ar-EG" : "en-US");
  const jobCode = (id: string) => jobs.find((j) => j.id === id)?.code ?? "—";
  const machineName = (id: string) => machines.find((m) => m.id === id)?.name ?? "—";

  const scope = (runs ?? []).filter((r) => (period === "all" ? true : (r.date || "").startsWith(ym)));
  const good = scope.reduce((s, r) => s + (r.goodUnits || 0), 0);
  const scrap = scope.reduce((s, r) => s + (r.scrapUnits || 0), 0);
  const downtime = scope.reduce((s, r) => s + (r.downtimeMin || 0), 0);
  const scrapRate = good + scrap ? ((scrap / (good + scrap)) * 100).toFixed(1) : "0.0";

  return (
    <div className="max-w-5xl">
      <div className={`flex items-center justify-between mb-1 ${isAr ? "flex-row-reverse" : ""}`}>
        <h1 className="text-2xl font-bold text-gray-900">{p.runs.title}</h1>
        <Btn onClick={() => { setForm(blank()); setOpen(true); }}><Plus size={15} /> {p.runs.add}</Btn>
      </div>
      <p className="text-sm text-gray-500 mb-6">{p.runs.subtitle}</p>

      {/* Period toggle */}
      <div className={`inline-flex rounded-lg border border-gray-200 bg-white p-0.5 mb-4 ${isAr ? "flex-row-reverse" : ""}`}>
        {(["month", "all"] as const).map((key) => (
          <button
            key={key}
            onClick={() => setPeriod(key)}
            className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
              period === key ? "bg-blue-600 text-white" : "text-gray-500 hover:text-gray-900"
            }`}
          >
            {key === "month" ? p.runs.thisMonth : p.runs.allTime}
          </button>
        ))}
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Stat label={p.runs.totalGood} value={fmt(good)} tone="green" />
        <Stat label={p.runs.totalScrap} value={fmt(scrap)} tone={scrap > 0 ? "red" : undefined} />
        <Stat label={p.runs.scrapRate} value={`${scrapRate}%`} tone={Number(scrapRate) > 3 ? "amber" : undefined} />
        <Stat label={p.runs.totalDowntime} value={`${fmt(downtime)} ${p.overview.minutes}`} />
      </div>

      {runs === null ? (
        <Spinner text={p.common.loading} />
      ) : runs.length === 0 ? (
        <EmptyState text={p.runs.empty} />
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm" dir={isAr ? "rtl" : "ltr"}>
            <thead>
              <tr className="text-gray-500 border-b border-gray-100 text-xs uppercase tracking-wide">
                <th className="text-start font-medium px-4 py-3">{p.runs.date}</th>
                <th className="text-start font-medium px-4 py-3">{p.runs.job}</th>
                <th className="text-start font-medium px-4 py-3">{p.runs.machine}</th>
                <th className="text-start font-medium px-4 py-3">{p.runs.good}</th>
                <th className="text-start font-medium px-4 py-3">{p.runs.scrap}</th>
                <th className="text-start font-medium px-4 py-3">{p.runs.downtime}</th>
                <th className="text-start font-medium px-4 py-3">{p.runs.operator}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {runs.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50/60">
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{r.date}</td>
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/jobs/${r.jobId}`} className="font-medium text-blue-600 hover:underline">
                      {jobCode(r.jobId)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{machineName(r.machineId)}</td>
                  <td className="px-4 py-3 text-green-600 font-medium">{fmt(r.goodUnits)}</td>
                  <td className="px-4 py-3 text-red-500">{r.scrapUnits ? fmt(r.scrapUnits) : "—"}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {r.downtimeMin ? `${fmt(r.downtimeMin)} ${p.overview.minutes}` : "—"}
                    {r.downtimeMin && r.downtimeReason && r.downtimeReason !== "None"
                      ? ` · ${localize(r.downtimeReason, DOWNTIME_REASONS, p.runs.reasons)}`
                      : ""}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{r.operator || "—"}</td>
                  <td className="px-4 py-3 text-end">
                    <button onClick={() => handleDelete(r.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Log production modal */}
      <Modal open={open} title={p.runs.add} onClose={() => setOpen(false)} isAr={isAr}>
        <form onSubmit={handleAdd}>
          <div className="grid sm:grid-cols-2 gap-x-4">
            <Field label={p.runs.date}>
              <input className={inputCls} type="date" required value={form.date} onChange={(e) => set("date", e.target.value)} />
            </Field>
            <Field label={p.runs.job}>
              <select className={inputCls} required value={form.jobId} onChange={(e) => set("jobId", e.target.value)}>
                <option value="">{p.common.select}</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>{j.code}</option>
                ))}
              </select>
            </Field>
            <Field label={p.runs.machine}>
              <select className={inputCls} value={form.machineId} onChange={(e) => set("machineId", e.target.value)}>
                <option value="">{p.common.select}</option>
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </Field>
            <Field label={p.runs.good}>
              <input className={inputCls} type="number" min="0" required value={form.goodUnits} onChange={(e) => set("goodUnits", e.target.value)} />
            </Field>
            <Field label={p.runs.scrap}>
              <input className={inputCls} type="number" min="0" value={form.scrapUnits} onChange={(e) => set("scrapUnits", e.target.value)} />
            </Field>
            <Field label={p.runs.downtime}>
              <input className={inputCls} type="number" min="0" value={form.downtimeMin} onChange={(e) => set("downtimeMin", e.target.value)} />
            </Field>
            <Field label={p.runs.reason}>
              <select className={inputCls} value={form.downtimeReason} onChange={(e) => set("downtimeReason", e.target.value)}>
                {options(DOWNTIME_REASONS, p.runs.reasons).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>
            <Field label={p.runs.operator}>
              <input className={inputCls} value={form.operator} onChange={(e) => set("operator", e.target.value)} />
            </Field>
          </div>
          <Field label={p.runs.note}>
            <textarea className={`${inputCls} resize-none`} rows={2} value={form.note} onChange={(e) => set("note", e.target.value)} />
          </Field>
          <div className={`flex gap-3 mt-2 ${isAr ? "flex-row-reverse" : ""}`}>
            <Btn type="submit" disabled={saving}>{p.common.save}</Btn>
            <Btn type="button" variant="outline" onClick={() => setOpen(false)}>{p.common.cancel}</Btn>
          </div>
        </form>
      </Modal>
    </div>
  );
}
