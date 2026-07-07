"use client";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { Plus, Circle } from "lucide-react";

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
    const res = await fetch("/api/machines", {
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

  const inputCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400";

  return (
    <div className="max-w-3xl">
      <div className={`flex items-center justify-between mb-1 ${isAr ? "flex-row-reverse" : ""}`}>
        <h1 className="text-2xl font-bold text-gray-900">{tr.dashboard.machines}</h1>
        {data?.writable && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded-lg font-medium transition-colors"
          >
            <Plus size={15} />
            {l.addRow}
          </button>
        )}
      </div>
      <p className={`text-sm text-gray-500 mb-6 ${isAr ? "text-right" : ""}`}>{l.subtitle}</p>

      {showForm && (
        <form onSubmit={handleAdd} className="bg-white border border-gray-200 rounded-xl p-6 mb-6 space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">{l.code}</label>
              <input value={form.code} onChange={(e) => set("code", e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">{l.machine}</label>
              <input value={form.name} onChange={(e) => set("name", e.target.value)} required className={inputCls} />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">{l.manufacturer}</label>
              <input value={form.manufacturer} onChange={(e) => set("manufacturer", e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">{l.status}</label>
              <select value={form.status} onChange={(e) => set("status", e.target.value)} className={inputCls}>
                {l.statuses.map((s) => <option key={s} value={s}>{l.statusLabel[s]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">{l.shiftLength}</label>
              <input type="number" min="0" step="30" value={form.shiftLength} onChange={(e) => set("shiftLength", e.target.value)} required className={inputCls} />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">{l.product}</label>
              <input value={form.product} onChange={(e) => set("product", e.target.value)} className={inputCls} />
            </div>
          </div>
          {saveErr && <p className="text-xs text-red-600">{l.saveFailed}</p>}
          <div className={`flex gap-3 ${isAr ? "flex-row-reverse" : ""}`}>
            <button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm px-5 py-2 rounded-lg font-medium transition-colors">
              {tr.dashboard.save}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="text-sm px-5 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
              {tr.dashboard.cancel}
            </button>
          </div>
        </form>
      )}

      {error || (data && !data.configured && data.machines.length === 0) ? (
        <div className="bg-white border border-dashed border-red-300 rounded-xl p-10 text-center text-sm text-red-600">{l.unreachable}</div>
      ) : !data ? null : data.machines.length === 0 ? (
        <p className="text-gray-400 text-sm">{l.empty}</p>
      ) : (
        <div className="space-y-3">
          {data.machines.map((m) => (
            <div key={m.row} className="bg-white border border-gray-200 rounded-xl px-5 py-4 flex items-center justify-between">
              <div className={`flex items-center gap-4 ${isAr ? "flex-row-reverse" : ""}`}>
                <Circle size={8} className={`fill-current ${statusColor(m.status)}`} />
                <div dir={isAr ? "rtl" : "ltr"}>
                  <p className="font-medium text-gray-900">{m.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {m.manufacturer && <>{m.manufacturer} · </>}
                    {m.shiftLength > 0 && <>{m.shiftLength} {l.min} · </>}
                    {m.product ? m.product : !m.code ? l.noCode : ""}
                  </p>
                </div>
              </div>
              <span className={`text-xs ${statusColor(m.status)}`}>{l.statusLabel[m.status] ?? m.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
