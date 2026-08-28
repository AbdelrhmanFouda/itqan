"use client";
import { usePageTitle } from "@/components/dashboard/use-page-title";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { Plus, Circle } from "lucide-react";
import { authedFetch } from "@/lib/authed-fetch";
import { Btn, EmptyState, Field, Spinner, inputCls } from "@/components/dashboard/ui";

/**
 * Machine registry — read from the sheet's `machines` tab (one row per
 * PHYSICAL machine; the PQPI code is the unique id since several tonnages
 * exist twice). The form appends a new registry row.
 */

type MachineInfo = {
  row: number;
  code: string;
  name: string;
  label: string;
  product: string;
  manufacturer: string;
  status: string;
  shiftLength: number;
};
type Data = { machines: MachineInfo[]; writable: boolean; configured: boolean };

const L = {
  en: {
    subtitle: "From the machines tab — one row per physical machine, identified by its code",
    addRow: "Add machine", code: "Machine code (e.g. PQPI 16)", machine: "Tonnage (e.g. 220)",
    manufacturer: "Manufacturer", status: "Status", statuses: ["Active", "Inactive"] as const,
    statusLabel: { Active: "Active", Inactive: "Inactive" } as Record<string, string>,
    shiftLength: "Shift length (min)", product: "Current product (optional)",
    noCode: "no code — add one in the sheet", min: "min",
    empty: "No machines found in the sheet's machines tab yet.",
    unreachable: "Couldn't reach the data sheet. Check the connection and reload.",
    saveFailed: "Saving failed — check the Apps Script deployment.",
  },
  ar: {
    subtitle: "من تبويب machines — صف لكل ماكينة فعلية، وهويتها هي الكود",
    addRow: "إضافة ماكينة", code: "كود الماكينة (مثال PQPI 16)", machine: "الحمولة (مثال 220)",
    manufacturer: "الشركة المصنعة", status: "الحالة", statuses: ["Active", "Inactive"] as const,
    statusLabel: { Active: "تعمل", Inactive: "متوقفة" } as Record<string, string>,
    shiftLength: "طول الوردية (دقيقة)", product: "المنتج الحالي (اختياري)",
    noCode: "بدون كود — أضفه في الشيت", min: "د",
    empty: "لا توجد ماكينات في تبويب machines بعد.",
    unreachable: "تعذّر الوصول إلى جدول البيانات. تحقق من الاتصال وأعد التحميل.",
    saveFailed: "فشل الحفظ — تحقق من نشر Apps Script.",
  },
};

const statusColor = (s: string) =>
  /inactive|متوقفة|خارج/i.test(s) ? "text-gray-400"
    : /active|تعمل/i.test(s) ? "text-green-500"
      : "text-gray-400";

export default function MachinesPage() {
  const { lang } = useLang();
  const tr = t[lang];
  const l = L[lang];
  const isAr = lang === "ar";
  usePageTitle(tr.dashboard.machines);

  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", manufacturer: "", status: "Active", shiftLength: "720", product: "" });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function load() {
    try {
      const res = await fetch("/api/machines");
      if (!res.ok) throw new Error("bad_status");
      setData(await res.json());
    } catch {
      setError(true);
    }
  }
  useEffect(() => { load(); }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveErr(false);
    const res = await authedFetch("/api/machines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    }).catch(() => null);
    setSaving(false);
    if (!res || !res.ok) { setSaveErr(true); return; }
    setForm({ code: "", name: "", manufacturer: "", status: "Active", shiftLength: "720", product: "" });
    setShowForm(false);
    load();
  }

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="max-w-3xl">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">{tr.dashboard.machines}</h1>
        <p className="text-sm text-gray-500">{l.subtitle}</p>
        {data?.writable && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Btn onClick={() => setShowForm(!showForm)}>
              <Plus size={15} />
              {l.addRow}
            </Btn>
          </div>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5 mb-6 space-y-4">
          <div className="grid sm:grid-cols-2 gap-x-4">
            <Field label={l.code}>
              <input value={form.code} onChange={(e) => set("code", e.target.value)} className={inputCls} />
            </Field>
            <Field label={l.machine}>
              <input value={form.name} onChange={(e) => set("name", e.target.value)} required className={inputCls} />
            </Field>
            <Field label={l.manufacturer}>
              <input value={form.manufacturer} onChange={(e) => set("manufacturer", e.target.value)} className={inputCls} />
            </Field>
            <Field label={l.status}>
              <select value={form.status} onChange={(e) => set("status", e.target.value)} className={inputCls}>
                {l.statuses.map((s) => <option key={s} value={s}>{l.statusLabel[s]}</option>)}
              </select>
            </Field>
            <Field label={l.shiftLength}>
              <input type="number" min="0" step="30" value={form.shiftLength} onChange={(e) => set("shiftLength", e.target.value)} required className={inputCls} />
            </Field>
            <Field label={l.product}>
              <input value={form.product} onChange={(e) => set("product", e.target.value)} className={inputCls} />
            </Field>
          </div>
          {saveErr && <p className="text-xs text-red-600">{l.saveFailed}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <Btn type="submit" disabled={saving}>{tr.dashboard.save}</Btn>
            <Btn variant="outline" onClick={() => setShowForm(false)}>{tr.dashboard.cancel}</Btn>
          </div>
        </form>
      )}

      {error || (data && !data.configured && data.machines.length === 0) ? (
        <div className="bg-white border border-dashed border-red-300 rounded-xl p-10 text-center text-sm text-red-600">{l.unreachable}</div>
      ) : !data ? (
        <div className="flex justify-center py-16">
          <Spinner text={isAr ? "جارٍ التحميل…" : "Loading…"} />
        </div>
      ) : data.machines.length === 0 ? (
        <EmptyState text={l.empty} />
      ) : (
        <div className="space-y-3">
          {data.machines.map((m) => (
            <div key={m.row} className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-4 min-w-0">
                <Circle size={8} className={`shrink-0 fill-current ${statusColor(m.status)}`} />
                <div className="min-w-0">
                  <p dir="ltr" className="font-medium text-gray-900 truncate text-start">{m.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {[
                      m.manufacturer,
                      m.shiftLength > 0 ? `${m.shiftLength.toLocaleString(isAr ? "ar-EG" : "en-US")} ${l.min}` : "",
                      m.product || (!m.code ? l.noCode : ""),
                    ].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </div>
              <span className={`shrink-0 text-xs ${statusColor(m.status)}`}>{l.statusLabel[m.status] ?? m.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
