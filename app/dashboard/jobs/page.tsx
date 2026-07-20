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

/**
 * Jobs — client work orders, stored in the sheet's `jobs` tab.
 * Progress fills automatically from production rows that match the job's
 * product name on/after its start date.
 */

type Job = {
  id: string; code: string; client: string; product: string; moldCode: string;
  qtyOrdered: number; startDate: string; dueDate: string;
  status: string; priority: string; machine: string;
  materialIssued: string; masterbatch: string; instructions: string; notes: string;
  produced: number; scrapped: number;
};
type Data = { jobs: Job[]; writable: boolean; configured: boolean };
type Mold = { row: number; code?: string; name?: string };
type MachineAgg = { name: string };

const empty = {
  code: "", client: "", product: "", moldCode: "", qtyOrdered: "", startDate: "",
  dueDate: "", status: "In Production", priority: "Normal", machine: "",
  materialIssued: "", masterbatch: "", instructions: "", notes: "",
};

export default function JobsPage() {
  const { lang } = useLang();
  const p = pd[lang];
  const isAr = lang === "ar";
  const today = new Date().toISOString().slice(0, 10);

  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);
  const [molds, setMolds] = useState<Mold[]>([]);
  const [machines, setMachines] = useState<MachineAgg[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...empty, startDate: today });
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(false);

  async function load() {
    try {
      const [j, mo, ma] = await Promise.all([
        fetch("/api/jobs").then((r) => r.json()),
        fetch("/api/sheet/molds").then((r) => r.json()).catch(() => ({ records: [] })),
        fetch("/api/machines").then((r) => r.json()).catch(() => ({ machines: [] })),
      ]);
      setData(j);
      setMolds(mo.records ?? []);
      setMachines(ma.machines ?? []);
    } catch {
      setError(true);
    }
  }
  useEffect(() => { load(); }, []);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveErr(false);
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    }).catch(() => null);
    setSaving(false);
    if (!res || !res.ok) { setSaveErr(true); return; }
    setForm({ ...empty, startDate: today });
    setOpen(false);
    load();
  }

  const fmt = (n: number) => Number(n || 0).toLocaleString(isAr ? "ar-EG" : "en-US");
  const startLabel = isAr ? "تاريخ البدء" : "Start date";
  const jobsTabMissing = isAr
    ? "تبويب jobs غير موجود في جدول البيانات. أضِف تبويبًا باسم jobs وضَع هذه العناوين في الصف الأول، ثم أعد التحميل."
    : "The sheet has no `jobs` tab yet. Add a tab named jobs with these headers in row 1, then reload.";
  const headers = "كود الأمر Job Code · العميل Client · المنتج Product · الكمية المطلوبة Qty Ordered · تاريخ البدء Start Date · تاريخ التسليم Due Date · الحالة Status · الأولوية Priority · الماكينة Machine · ملاحظات Notes";

  if (error) {
    return (
      <div className="max-w-5xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">{p.jobs.title}</h1>
        <div className="bg-white border border-dashed border-red-300 rounded-xl p-10 text-center text-sm text-red-600">
          {isAr ? "تعذّر الوصول إلى البيانات." : "Couldn't reach the data."}
        </div>
      </div>
    );
  }
  if (!data) return <Spinner text={p.common.loading} />;

  return (
    <div className="max-w-5xl">
      <div className={`flex flex-wrap items-center justify-between gap-3 mb-1 ${isAr ? "flex-row-reverse" : ""}`}>
        <h1 className="text-2xl font-bold text-gray-900">{p.jobs.title}</h1>
        {data.writable && data.configured && (
          <Btn onClick={() => { setSaveErr(false); setOpen(true); }}><Plus size={15} /> {p.jobs.add}</Btn>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-6">{p.jobs.subtitle}</p>

      {!data.configured ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5" dir={isAr ? "rtl" : "ltr"}>
          <p className="text-sm font-medium text-amber-900 mb-2">{jobsTabMissing}</p>
          <p className="text-xs text-amber-800 leading-relaxed" dir="rtl">{headers}</p>
        </div>
      ) : data.jobs.length === 0 ? (
        <EmptyState text={p.jobs.empty} />
      ) : (
        <div className="space-y-3">
          {data.jobs.map((j) => {
            const pct = j.qtyOrdered ? Math.min(100, (j.produced / j.qtyOrdered) * 100) : 0;
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
                      {[j.client, j.product, j.machine].filter(Boolean).join(" · ") || "—"}
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
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden" dir="ltr">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-gray-500 whitespace-nowrap">
                    {fmt(j.produced)} / {fmt(j.qtyOrdered)}
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
              <input className={inputCls} required list="job-products" value={form.product} onChange={(e) => set("product", e.target.value)} />
              <datalist id="job-products">
                {molds.map((m) => (m.name ? <option key={m.row} value={m.name} /> : null))}
              </datalist>
            </Field>
            <Field label={isAr ? "كود الاسطمبة" : "Mold code"}>
              <input className={inputCls} list="job-moldcodes" value={form.moldCode} onChange={(e) => set("moldCode", e.target.value)} />
              <datalist id="job-moldcodes">
                {molds.map((m) => (m.code ? <option key={`c${m.row}`} value={m.code} /> : null))}
              </datalist>
            </Field>
            <Field label={p.jobs.qtyOrdered}>
              <input className={inputCls} type="number" min="0" required value={form.qtyOrdered} onChange={(e) => set("qtyOrdered", e.target.value)} />
            </Field>
            <Field label={isAr ? "الخامة المصروفة (كجم)" : "Material issued (kg)"}>
              <input className={inputCls} value={form.materialIssued} onChange={(e) => set("materialIssued", e.target.value)} />
            </Field>
            <Field label={isAr ? "الماستر باتش" : "Masterbatch"}>
              <input className={inputCls} value={form.masterbatch} onChange={(e) => set("masterbatch", e.target.value)} />
            </Field>
            <Field label={startLabel}>
              <input className={inputCls} type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />
            </Field>
            <Field label={p.jobs.due}>
              <input className={inputCls} type="date" value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
            </Field>
            <Field label={p.jobs.machine}>
              <select className={inputCls} value={form.machine} onChange={(e) => set("machine", e.target.value)}>
                <option value="">{p.common.select}</option>
                {machines.map((m) => (
                  <option key={m.name} value={m.name}>{m.name}</option>
                ))}
              </select>
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
          <Field label={isAr ? "التعليمات" : "Instructions"}>
            <textarea className={`${inputCls} resize-none`} rows={2} value={form.instructions} onChange={(e) => set("instructions", e.target.value)} />
          </Field>
          <Field label={p.jobs.notes}>
            <textarea className={`${inputCls} resize-none`} rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </Field>
          {saveErr && <p className="text-xs text-red-600 mt-1">{isAr ? "فشل الحفظ." : "Saving failed."}</p>}
          <div className={`flex gap-3 mt-2 ${isAr ? "flex-row-reverse" : ""}`}>
            <Btn type="submit" disabled={saving}>{p.common.save}</Btn>
            <Btn type="button" variant="outline" onClick={() => setOpen(false)}>{p.common.cancel}</Btn>
          </div>
        </form>
      </Modal>
    </div>
  );
}
