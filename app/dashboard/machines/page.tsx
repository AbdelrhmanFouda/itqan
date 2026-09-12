"use client";
import { usePageTitle } from "@/components/dashboard/use-page-title";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import { useState } from "react";
import { Plus, Circle, RefreshCw } from "lucide-react";
import { authedFetch } from "@/lib/authed-fetch";
import { pd } from "@/lib/i18n.prod";
import { Btn, EmptyState, Field, Spinner, inputCls, LoadError } from "@/components/dashboard/ui";
import { timedJson } from "@/components/dashboard/last-seen";
import { useRemembered } from "@/components/dashboard/use-remembered";
import { fmtNum } from "@/lib/format";

/**
 * Machine registry — read from the sheet's `machines` tab (one row per
 * PHYSICAL machine; the PQPI code is the unique id since several tonnages
 * exist twice). The form appends a new registry row.
 *
 * Speed (2026-09-10): «الماكينات» is a sheet tab, so a cold instance takes
 * seconds to answer and the page used to spin for all of it with no timeout
 * at all — the spinner stayed until the platform killed the function. Now the
 * registry this device saw last renders AT ONCE (localStorage), the live read
 * is bounded, and a failure keeps what is on screen and says so with a retry.
 * A failed or empty answer NEVER replaces a good list.
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

/** The last registry this device saw — rendered before the network is touched. */
const LAST_KEY = "itqan.machines.last";

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
  const p = pd[lang];
  const isAr = lang === "ar";
  usePageTitle(tr.dashboard.machines);

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", manufacturer: "", status: "Active", shiftLength: "720", product: "" });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // `/api/machines` is an open read, so a plain bounded fetch is right here.
  // A stalled bridge must not blank a registry the person was reading a second
  // ago, and an EMPTY answer never replaces a registry that has rows — "no
  // machines" read as the truth is the lie those two rules guard against.
  const { data, loading, failed, reload: load } = useRemembered<Data>({
    key: LAST_KEY,
    read: async () => {
      const r = await timedJson<Data>(fetch, "/api/machines");
      return r.ok && !Array.isArray(r.data?.machines) ? { ok: false, status: 0, timedOut: false } : r;
    },
    valid: (snap) => Array.isArray(snap?.machines),
    merge: (prev, next) => (prev && prev.machines.length > 0 && next.machines.length === 0 ? prev : next),
    worthRemembering: (next) => next.machines.length > 0,
  });

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
        {/* A list is on screen and the live read did not arrive: say so, keep the list. */}
        {failed && data && (
          <LoadError
            className="mt-2"
            text={failed.timedOut ? p.common.timedOut : p.common.loadError}
            retry={p.common.retry}
            onRetry={load}
            loading={loading}
            icon={<RefreshCw size={13} className={loading ? "animate-spin" : ""} />}
          />
        )}
        {/* A remembered list is showing while the live read is still in flight. */}
        {!failed && loading && data && <p className="text-xs text-gray-400 mt-2">{p.common.stillLoading}</p>}
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

      {(failed && !data) || (data && !data.configured && data.machines.length === 0) ? (
        <LoadError
          variant="empty"
          text={failed?.timedOut ? p.common.timedOut : l.unreachable}
          retry={p.common.retry}
          onRetry={load}
          loading={loading}
          icon={<RefreshCw size={14} className={loading ? "animate-spin" : ""} />}
        />
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
                      m.shiftLength > 0 ? `${fmtNum(m.shiftLength, isAr)} ${l.min}` : "",
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
