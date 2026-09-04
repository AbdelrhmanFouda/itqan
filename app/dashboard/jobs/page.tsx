"use client";
import { usePageTitle } from "@/components/dashboard/use-page-title";
import { useLang } from "@/context/LangContext";
import { pd } from "@/lib/i18n.prod";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Pill, Field, inputCls, Btn, Modal, EmptyState, Spinner } from "@/components/dashboard/ui";
import {
  JOB_STATUSES, JOB_PRIORITIES, jobTone, priorityTone, localize, options,
} from "@/lib/prod-meta";
import { authedFetch } from "@/lib/authed-fetch";
import { LOCALE_AR } from "@/lib/format";

/**
 * Jobs — client work orders, stored in the sheet's `jobs` tab.
 * Progress fills automatically from production rows that match the job's
 * product name on/after its start date.
 */

type Job = {
  id: string; code: string; client: string; product: string; moldCode: string;
  // qtyOrdered is PIECES (converted from kg via Master's piece weight, in
  // lib/jobs.ts). 0 means Master has no weight for this product.
  qtyOrdered: number; qtyOrderedKg: number; startDate: string; dueDate: string;
  status: string; priority: string; machine: string;
  materialIssued: string; masterbatch: string; instructions: string; notes: string;
  produced: number; scrapped: number; remaining: number;
  linked: boolean; ambiguous: boolean; pieceWeightG: number; cavities: number; cycleSec: number;
  material: string; estHours: number;
  // Master's mould number for the product ("" when Master has none).
  masterMoldNumber: string; masterMoldNotesNumber: string;
};
type Data = { jobs: Job[]; writable: boolean; configured: boolean };
type Mold = { row: number; code?: string; name?: string };
type MachineAgg = { name: string };

const empty = {
  code: "", client: "", product: "", moldCode: "", qtyOrdered: "", startDate: "",
  dueDate: "", status: "Not Started", priority: "Normal", machine: "",
  materialIssued: "", masterbatch: "", instructions: "", notes: "",
};

export default function JobsPage() {
  const { lang } = useLang();
  const p = pd[lang];
  const isAr = lang === "ar";
  usePageTitle(p.jobs.title);
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
    // The order book renders the moment /api/jobs answers. The two lists that
    // only feed the add-form's datalists (Master names + codes, the machine
    // registry) arrive on their own: a cold bridge read of «الاسطمبات» is
    // 2–5s, and until 2026-09-04 the whole page waited for it.
    fetch("/api/sheet/molds").then((r) => r.json()).then((mo) => setMolds(mo.records ?? [])).catch(() => {});
    fetch("/api/machines").then((r) => r.json()).then((ma) => setMachines(ma.machines ?? [])).catch(() => {});
    try {
      // A non-2xx (401 on a missing/expired token) must land in the ERROR
      // state — parsed as data it flows into `configured: undefined` and the
      // page tells the user to go add a `jobs` tab to the sheet, which is a
      // lie about what went wrong.
      const r = await authedFetch("/api/jobs");
      if (!r.ok) throw new Error(String(r.status));
      setData(await r.json());
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
    const res = await authedFetch("/api/jobs", {
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

  const fmt = (n: number) => Number(n || 0).toLocaleString(isAr ? LOCALE_AR : "en-US");
  const startLabel = isAr ? "تاريخ البدء" : "Start date";
  const jobsTabMissing = isAr
    ? "تبويب jobs غير موجود في جدول البيانات. أضِف تبويبًا باسم jobs وضَع هذه العناوين في الصف الأول، ثم أعد التحميل."
    : "The sheet has no `jobs` tab yet. Add a tab named jobs with these headers in row 1, then reload.";
  const headers = "كود الأمر Job Code · العميل Client · المنتج Product · الكمية المطلوبة Qty Ordered · تاريخ البدء Start Date · تاريخ التسليم Due Date · الحالة Status · الأولوية Priority · الماكينة Machine · ملاحظات Notes";

  if (error) {
    return (
      <div className="max-w-5xl" dir={isAr ? "rtl" : "ltr"}>
        <h1 className="text-2xl font-bold text-gray-900 mb-4">{p.jobs.title}</h1>
        <div className="bg-white border border-dashed border-red-300 rounded-xl p-10 text-center text-sm text-red-600">
          {isAr ? "تعذّر الوصول إلى البيانات." : "Couldn't reach the data."}
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex justify-center py-16">
        <Spinner text={p.common.loading} />
      </div>
    );
  }

  return (
    <div className="max-w-5xl" dir={isAr ? "rtl" : "ltr"}>
      <div className="mb-6 sm:mb-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">{p.jobs.title}</h1>
          {data.writable && data.configured && (
            <Btn onClick={() => { setSaveErr(false); setOpen(true); }}><Plus size={15} /> {p.jobs.add}</Btn>
          )}
        </div>
        <p className="text-sm text-gray-500">{p.jobs.subtitle}</p>
      </div>

      {!data.configured ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 sm:p-5">
          <p className="text-sm font-medium text-amber-900 mb-2">{jobsTabMissing}</p>
          <p className="text-xs text-amber-800 leading-relaxed" dir="rtl">
            {headers.split(" · ").map((h) => (
              <span key={h} className="inline-block bg-amber-100/60 rounded px-1.5 py-0.5 me-1 mb-1">{h}</span>
            ))}
          </p>
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
                className="block bg-white border border-gray-200 rounded-xl p-4 sm:p-5 transition-colors hover:border-gray-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    {/* flex-wrap: code + two pills don't fit one phone line;
                        wrapping beats squeezing the pills off the card. */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-semibold text-gray-900">{j.code}</span>
                      <Pill text={localize(j.status, JOB_STATUSES, p.jobs.statuses)} tone={jobTone(j.status)} />
                      <Pill text={localize(j.priority, JOB_PRIORITIES, p.jobs.priorities)} tone={priorityTone(j.priority)} />
                      {/* The name matches >1 Master row — the numbers below may
                          belong to a different product with the same name. */}
                      {j.ambiguous && <Pill text={p.jobs.ambiguous} tone="amber" />}
                    </div>
                    <p className="text-xs text-gray-500 mt-1 truncate">
                      {[
                        j.client,
                        // The product with Master's mould number beside it,
                        // so the floor can find the tool from the job card.
                        j.product && j.masterMoldNumber ? `${j.product} (${p.jobs.moldNumber} ${j.masterMoldNumber})` : j.product,
                        j.machine,
                      ].filter(Boolean).join(" · ") || "—"}
                    </p>
                    {/* Shows the kg→pieces working, so the number is never a black box. */}
                    <p className="text-[11px] text-gray-400 mt-0.5 truncate tabular-nums">
                      {!j.linked
                        ? p.jobs.notInMaster
                        : j.qtyOrdered > 0
                          ? `${fmt(j.qtyOrderedKg)} ${p.jobs.kg} × ${j.pieceWeightG} ${p.jobs.gPerPc} = ${fmt(j.qtyOrdered)} ${p.jobs.pcs}`
                          : p.jobs.noWeight}
                    </p>
                    {/* Phone: the due date lives under the meta instead of in a
                        side column that would squeeze the code + pills row. */}
                    {j.dueDate && (
                      <p className={`sm:hidden text-xs mt-1 ${overdue ? "text-red-600 font-medium" : "text-gray-400"}`}>
                        {p.jobs.due}: {j.dueDate}{overdue ? ` · ${p.jobs.overdue}` : ""}
                      </p>
                    )}
                  </div>
                  <div className="hidden sm:block text-xs shrink-0 text-end">
                    {j.dueDate && (
                      <p className={overdue ? "text-red-600 font-medium" : "text-gray-400"}>
                        {p.jobs.due}: {j.dueDate}{overdue ? ` · ${p.jobs.overdue}` : ""}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-3">
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden" dir="ltr">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-gray-500 whitespace-nowrap tabular-nums" dir="ltr">
                    {j.qtyOrdered > 0
                      ? `${fmt(j.produced)} / ${fmt(j.qtyOrdered)} ${p.jobs.pcs}`
                      : `${fmt(j.produced)} ${p.jobs.pcs}`}
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
            {/* The sheet column is «الكمية المطلوبة (كجم)» — label the unit so
                nobody types a piece count into a kilogram field. */}
            <Field label={p.jobs.qtyOrderedKg}>
              <input className={inputCls} type="number" min="0" step="any" required value={form.qtyOrdered} onChange={(e) => set("qtyOrdered", e.target.value)} />
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
          <div className="flex flex-wrap items-center gap-3 mt-2">
            <Btn type="submit" disabled={saving}>{p.common.save}</Btn>
            <Btn type="button" variant="outline" onClick={() => setOpen(false)}>{p.common.cancel}</Btn>
          </div>
        </form>
      </Modal>
    </div>
  );
}
