"use client";
import { useLang } from "@/context/LangContext";
import { pd } from "@/lib/i18n.prod";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Stat, Pill, Field, inputCls, Btn, Modal, EmptyState, Spinner } from "@/components/dashboard/ui";
import {
  JOB_STATUSES, JOB_PRIORITIES, DOWNTIME_REASONS, SHIFTS,
  priorityTone, localize, options,
} from "@/lib/prod-meta";

/**
 * One job (sheet row in the `jobs` tab) + the production runs credited to it
 * (matched by product name on/after the start date). Logging a run here
 * appends a production row pre-filled with the job's product.
 */

type Job = {
  id: string; code: string; client: string; product: string; moldCode: string;
  qtyOrdered: number; startDate: string; dueDate: string;
  status: string; priority: string; machine: string;
  materialIssued: string; masterbatch: string; instructions: string; notes: string;
  produced: number; scrapped: number;
};
type Standard = {
  weight: string; material: string; cavities: number | null; cycleSec: number | null;
  defects: string; ratePerHour: number | null; ratePerShift12h: number | null;
};
type Run = {
  id: string; date: string; machine: string;
  goodUnits: number; scrapUnits: number; downtimeMin: number;
  downtimeReason: string; operator: string; note: string;
};
type MachineAgg = { name: string };

export default function JobDetailPage() {
  const { lang } = useLang();
  const p = pd[lang];
  const isAr = lang === "ar";
  const params = useParams();
  const router = useRouter();
  const id = String(params.id);

  const [job, setJob] = useState<Job | null>(null);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [standard, setStandard] = useState<Standard | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [machines, setMachines] = useState<MachineAgg[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const blankRun = useCallback(
    () => ({
      date: today, shift: SHIFTS[0], machine: "", goodUnits: "", scrapUnits: "",
      downtimeMin: "", downtimeReason: "None", operator: "", note: "",
    }),
    [today]
  );
  const [form, setForm] = useState(blankRun());

  const load = useCallback(async () => {
    const [jRes, ma] = await Promise.all([
      fetch(`/api/jobs/${id}`),
      fetch("/api/machines").then((x) => x.json()).catch(() => ({ machines: [] })),
    ]);
    if (!jRes.ok) { setNotFound(true); return; }
    const j = await jRes.json();
    setJob(j.job);
    setRuns(j.runs ?? []);
    setStandard(j.standard ?? null);
    setMachines(ma.machines ?? []);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function openLog() {
    setForm({ ...blankRun(), machine: job?.machine ?? "" });
    setOpen(true);
  }

  async function handleAddRun(e: React.FormEvent) {
    e.preventDefault();
    if (!job) return;
    setSaving(true);
    await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, product: job.product }),
    });
    setOpen(false);
    setSaving(false);
    load();
  }

  async function handleStatus(status: string) {
    if (!job) return;
    setJob({ ...job, status });
    await fetch(`/api/jobs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  }

  async function handleDeleteRun(runId: string) {
    if (!confirm(p.common.confirmDelete)) return;
    await fetch(`/api/runs/${runId}`, { method: "DELETE" });
    load();
  }

  async function handleDeleteJob() {
    if (!confirm(p.common.confirmDelete)) return;
    await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    router.push("/dashboard/jobs");
  }

  const fmt = (n: number) => Number(n || 0).toLocaleString(isAr ? "ar-EG" : "en-US");
  const startLabel = isAr ? "تاريخ البدء" : "Start date";

  if (notFound) {
    return (
      <div className="max-w-3xl">
        <Link href="/dashboard/jobs" className="text-sm text-blue-600 hover:underline">{p.common.back}</Link>
        <EmptyState text={p.jobs.empty} />
      </div>
    );
  }
  if (!job || runs === null) return <Spinner text={p.common.loading} />;

  const good = job.produced;
  const scrap = job.scrapped;
  const downtime = runs.reduce((s, r) => s + (r.downtimeMin || 0), 0);
  const scrapRate = good + scrap ? ((scrap / (good + scrap)) * 100).toFixed(1) : "0.0";
  const qty = Number(job.qtyOrdered) || 0;
  const remaining = Math.max(0, qty - good);
  const pct = qty ? Math.min(100, (good / qty) * 100) : 0;
  const overdue = !["Completed", "Delivered"].includes(job.status) && job.dueDate && job.dueDate < today;

  return (
    <div className="max-w-4xl" dir={isAr ? "rtl" : "ltr"}>
      <Link href="/dashboard/jobs" className="text-sm text-blue-600 hover:underline">{p.common.back}</Link>

      {/* Header */}
      <div className={`flex items-start justify-between gap-4 mt-3 mb-1 ${isAr ? "flex-row-reverse" : ""}`}>
        <div className={isAr ? "text-right" : ""}>
          <div className={`flex items-center gap-2 ${isAr ? "flex-row-reverse" : ""}`}>
            <h1 className="text-2xl font-bold text-gray-900">{job.code}</h1>
            <Pill text={localize(job.priority, JOB_PRIORITIES, p.jobs.priorities)} tone={priorityTone(job.priority)} />
          </div>
          <p className="text-sm text-gray-500 mt-1">{[job.client, job.product].filter(Boolean).join(" · ")}</p>
        </div>
        <div className={`flex items-center gap-2 ${isAr ? "flex-row-reverse" : ""}`}>
          <select
            value={job.status}
            onChange={(e) => handleStatus(e.target.value)}
            className={`${inputCls} w-auto`}
          >
            {options(JOB_STATUSES, p.jobs.statuses).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button onClick={handleDeleteJob} className="text-gray-300 hover:text-red-500 transition-colors p-2" title={p.common.delete}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Work order — أمر الشغل (matches the paper form; Master fills the standards) */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mt-4 mb-6">
        <div className={`flex items-center justify-between mb-4 ${isAr ? "flex-row-reverse" : ""}`}>
          <h2 className="font-semibold text-gray-900">{isAr ? "أمر الشغل" : "Work Order"}</h2>
          <button
            onClick={() => window.print()}
            className="text-xs text-gray-500 hover:text-gray-900 border border-gray-200 rounded px-2.5 py-1.5 transition-colors print:hidden"
          >
            {isAr ? "طباعة" : "Print"}
          </button>
        </div>
        <div className="grid sm:grid-cols-3 gap-y-4 gap-x-6 text-sm">
          <Detail label={p.jobs.part} value={job.product || "—"} />
          <Detail label={isAr ? "كود الاسطمبة" : "Mold code"} value={job.moldCode || "—"} />
          <Detail label={p.jobs.machine} value={job.machine || "—"} />
          <Detail label={startLabel} value={job.startDate || "—"} />
          <Detail
            label={p.jobs.due}
            value={job.dueDate ? `${job.dueDate}${overdue ? ` · ${p.jobs.overdue}` : ""}` : "—"}
            danger={!!overdue}
          />
          <Detail label={p.jobs.qtyOrdered} value={fmt(qty)} />
          <Detail label={isAr ? "الخامة المصروفة (كجم)" : "Material issued (kg)"} value={job.materialIssued || "—"} />
          <Detail label={isAr ? "الماستر باتش" : "Masterbatch"} value={job.masterbatch || "—"} />
          <Detail label={p.jobs.unitsRemaining} value={fmt(remaining)} />
          {standard ? (
            <>
              <Detail label={isAr ? "وزن القطعة (جم)" : "Part weight (g)"} value={standard.weight || "—"} />
              <Detail label={isAr ? "نوع الخامة" : "Material type"} value={standard.material || "—"} />
              <Detail
                label={isAr ? "الكافيتي × الدورة (ث)" : "Cavities × cycle (s)"}
                value={standard.cavities && standard.cycleSec ? `${standard.cavities} × ${standard.cycleSec}` : "—"}
              />
              <Detail
                label={isAr ? "معدل الإنتاج / الساعة" : "Expected / hour"}
                value={standard.ratePerHour ? fmt(standard.ratePerHour) : "—"}
              />
              <Detail
                label={isAr ? "معدل الوردية (12 س)" : "Expected / 12h shift"}
                value={standard.ratePerShift12h ? fmt(standard.ratePerShift12h) : "—"}
              />
              <Detail label={isAr ? "العيوب المحتملة" : "Possible defects"} value={standard.defects || "—"} />
            </>
          ) : (
            <div className="sm:col-span-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {isAr
                ? "لا يوجد معيار لهذا المنتج في Master (الوزن/الخامة/الدورة/الكافيتي) — أكمله لعرض أمر الشغل كاملاً."
                : "No Master standard for this product (weight/material/cycle/cavities) — fill it to complete the work order."}
            </div>
          )}
          {job.instructions ? (
            <div className="sm:col-span-3">
              <p className="text-xs text-gray-500 mb-0.5">{isAr ? "التعليمات" : "Instructions"}</p>
              <p className="text-gray-700 whitespace-pre-wrap">{job.instructions}</p>
            </div>
          ) : null}
          {job.notes ? (
            <div className="sm:col-span-3">
              <p className="text-xs text-gray-500 mb-0.5">{p.jobs.notes}</p>
              <p className="text-gray-700 whitespace-pre-wrap">{job.notes}</p>
            </div>
          ) : null}
        </div>
      </div>

      {/* Progress */}
      <div className={`flex items-center gap-3 mb-6 ${isAr ? "flex-row-reverse" : ""}`}>
        <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden" dir="ltr">
          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs text-gray-500 whitespace-nowrap">{fmt(good)} / {fmt(qty)} ({pct.toFixed(0)}%)</span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Stat label={p.runs.totalGood} value={fmt(good)} tone="green" />
        <Stat label={p.runs.totalScrap} value={fmt(scrap)} tone={scrap > 0 ? "red" : undefined} />
        <Stat label={p.runs.scrapRate} value={`${scrapRate}%`} tone={Number(scrapRate) > 3 ? "amber" : undefined} />
        <Stat label={p.runs.totalDowntime} value={`${fmt(downtime)} ${p.overview.minutes}`} />
      </div>

      {/* Runs credited to this job */}
      <div className={`flex items-center justify-between mb-3 ${isAr ? "flex-row-reverse" : ""}`}>
        <h2 className="font-semibold text-gray-900">{p.jobs.runsForJob}</h2>
        <Btn onClick={openLog}><Plus size={15} /> {p.runs.add}</Btn>
      </div>

      {runs.length === 0 ? (
        <EmptyState text={p.jobs.noRuns} />
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm" dir={isAr ? "rtl" : "ltr"}>
            <thead>
              <tr className="text-gray-500 border-b border-gray-100 text-xs uppercase tracking-wide">
                <th className="text-start font-medium px-4 py-3">{p.runs.date}</th>
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
                  <td className="px-4 py-3 text-gray-500">{r.machine || "—"}</td>
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
                    <button onClick={() => handleDeleteRun(r.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Log run modal — appends a production row for this job's product */}
      <Modal open={open} title={`${p.runs.add} · ${job.code}`} onClose={() => setOpen(false)} isAr={isAr}>
        <form onSubmit={handleAddRun}>
          <div className="grid sm:grid-cols-2 gap-x-4">
            <Field label={p.runs.date}>
              <input className={inputCls} type="date" required value={form.date} onChange={(e) => set("date", e.target.value)} />
            </Field>
            <Field label={p.runs.shift}>
              <select className={inputCls} value={form.shift} onChange={(e) => set("shift", e.target.value)}>
                {options(SHIFTS, p.runs.shifts).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>
            <Field label={p.runs.machine}>
              <select className={inputCls} value={form.machine} onChange={(e) => set("machine", e.target.value)}>
                <option value="">{p.common.select}</option>
                {machines.map((m) => (
                  <option key={m.name} value={m.name}>{m.name}</option>
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

function Detail({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className={`font-medium ${danger ? "text-red-600" : "text-gray-900"}`}>{value}</p>
    </div>
  );
}
