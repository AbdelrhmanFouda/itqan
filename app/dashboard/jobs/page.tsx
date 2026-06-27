"use client";
import { useLang } from "@/context/LangContext";
import { pd } from "@/lib/i18n.prod";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Pill, Field, inputCls, Btn, Modal, EmptyState, Spinner } from "@/components/dashboard/ui";
import {
  JOB_STATUSES, JOB_PRIORITIES, jobTone, priorityTone, localize, options,
} from "@/lib/prod-meta";

type Job = {
  id: string; code: string; client: string; partName: string;
  moldId: string; machineId: string; qtyOrdered: number;
  dueDate: string; status: string; priority: string; notes: string;
};
type Mold = { id: string; code: string; partName: string };
type Machine = { id: string; name: string };
type Run = { jobId: string; goodUnits: number };

const empty = {
  code: "", client: "", partName: "", moldId: "", machineId: "",
  qtyOrdered: "", dueDate: "", status: "In Production", priority: "Normal", notes: "",
};

export default function JobsPage() {
  const { lang } = useLang();
  const p = pd[lang];
  const isAr = lang === "ar";
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [molds, setMolds] = useState<Mold[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [produced, setProduced] = useState<Record<string, number>>({});
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);

  async function load() {
    const [j, m, mc, runs] = await Promise.all([
      fetch("/api/jobs").then((r) => r.json()),
      fetch("/api/molds").then((r) => r.json()),
      fetch("/api/machines").then((r) => r.json()),
      fetch("/api/runs").then((r) => r.json()),
    ]);
    setJobs(j); setMolds(m); setMachines(mc);
    const byJob: Record<string, number> = {};
    for (const r of runs as Run[]) byJob[r.jobId] = (byJob[r.jobId] ?? 0) + (r.goodUnits || 0);
    setProduced(byJob);
  }
  useEffect(() => { load(); }, []);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setForm({ ...empty });
    setOpen(false);
    setSaving(false);
    load();
  }

  const machineName = (id: string) => machines.find((m) => m.id === id)?.name ?? "—";
  const today = new Date().toISOString().slice(0, 10);
  const fmt = (n: number) => n.toLocaleString(isAr ? "ar-EG" : "en-US");

  return (
    <div className="max-w-5xl">
      <div className={`flex items-center justify-between mb-1 ${isAr ? "flex-row-reverse" : ""}`}>
        <h1 className="text-2xl font-bold text-gray-900">{p.jobs.title}</h1>
        <Btn onClick={() => setOpen(true)}><Plus size={15} /> {p.jobs.add}</Btn>
      </div>
      <p className="text-sm text-gray-500 mb-6">{p.jobs.subtitle}</p>

      {jobs === null ? (
        <Spinner text={p.common.loading} />
      ) : jobs.length === 0 ? (
        <EmptyState text={p.jobs.empty} />
      ) : (
        <div className="space-y-3">
          {jobs.map((j) => {
            const made = produced[j.id] ?? 0;
            const pct = j.qtyOrdered ? Math.min(100, (made / j.qtyOrdered) * 100) : 0;
            const overdue = !["Completed", "Delivered"].includes(j.status) && j.dueDate && j.dueDate < today;
            return (
              <Link
                key={j.id}
                href={`/dashboard/jobs/${j.id}`}
                className="block bg-white border border-gray-200 hover:border-blue-300 rounded-xl px-5 py-4 transition-colors"
              >
                <div className={`flex items-center justify-between gap-4 ${isAr ? "flex-row-reverse" : ""}`}>
                  <div dir={isAr ? "rtl" : "ltr"} className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900">{j.code}</span>
                      <Pill text={localize(j.status, JOB_STATUSES, p.jobs.statuses)} tone={jobTone(j.status)} />
                      <Pill text={localize(j.priority, JOB_PRIORITIES, p.jobs.priorities)} tone={priorityTone(j.priority)} />
                    </div>
                    <p className="text-xs text-gray-500 mt-1 truncate">
                      {j.client} · {j.partName} · {machineName(j.machineId)}
                    </p>
                  </div>
                  <div className={`text-xs shrink-0 ${isAr ? "text-left" : "text-right"}`}>
                    {j.dueDate && (
                      <p className={overdue ? "text-red-600 font-medium" : "text-gray-400"}>
                        {p.jobs.due}: {j.dueDate}{overdue ? ` · ${p.jobs.overdue}` : ""}
                      </p>
                    )}
                  </div>
                </div>
                <div className={`flex items-center gap-3 mt-3 ${isAr ? "flex-row-reverse" : ""}`}>
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-gray-500 whitespace-nowrap">
                    {fmt(made)} / {fmt(j.qtyOrdered)}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <Modal open={open} title={p.jobs.add} onClose={() => setOpen(false)} isAr={isAr}>
        <form onSubmit={handleAdd}>
          <div className="grid sm:grid-cols-2 gap-x-4">
            <Field label={p.jobs.code}>
              <input className={inputCls} required value={form.code} placeholder={p.jobs.placeholderCode} onChange={(e) => set("code", e.target.value)} />
            </Field>
            <Field label={p.jobs.client}>
              <input className={inputCls} required value={form.client} onChange={(e) => set("client", e.target.value)} />
            </Field>
            <Field label={p.jobs.part}>
              <input className={inputCls} required value={form.partName} onChange={(e) => set("partName", e.target.value)} />
            </Field>
            <Field label={p.jobs.qtyOrdered}>
              <input className={inputCls} type="number" min="0" required value={form.qtyOrdered} onChange={(e) => set("qtyOrdered", e.target.value)} />
            </Field>
            <Field label={p.jobs.mold}>
              <select className={inputCls} value={form.moldId} onChange={(e) => set("moldId", e.target.value)}>
                <option value="">{p.common.select}</option>
                {molds.map((m) => (
                  <option key={m.id} value={m.id}>{m.code} — {m.partName}</option>
                ))}
              </select>
            </Field>
            <Field label={p.jobs.machine}>
              <select className={inputCls} value={form.machineId} onChange={(e) => set("machineId", e.target.value)}>
                <option value="">{p.common.select}</option>
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </Field>
            <Field label={p.jobs.due}>
              <input className={inputCls} type="date" value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
            </Field>
            <Field label={p.jobs.status}>
              <select className={inputCls} value={form.status} onChange={(e) => set("status", e.target.value)}>
                {options(JOB_STATUSES, p.jobs.statuses).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>
            <Field label={p.jobs.priority}>
              <select className={inputCls} value={form.priority} onChange={(e) => set("priority", e.target.value)}>
                {options(JOB_PRIORITIES, p.jobs.priorities).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label={p.jobs.notes}>
            <textarea className={`${inputCls} resize-none`} rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
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
