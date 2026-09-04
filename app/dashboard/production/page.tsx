"use client";
import { usePageTitle } from "@/components/dashboard/use-page-title";
import { useLang } from "@/context/LangContext";
import { pd } from "@/lib/i18n.prod";
import { useEffect, useState, useCallback, useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Stat, Field, inputCls, Btn, Modal, EmptyState, Spinner } from "@/components/dashboard/ui";
import { DOWNTIME_REASONS, SHIFTS, localize, options } from "@/lib/prod-meta";
import { authedFetch } from "@/lib/authed-fetch";
import { moldKey } from "@/lib/mold-number";
import { LOCALE_AR } from "@/lib/format";

type Run = {
  id: string; date: string; shift: string; machine: string; machineCode: string; mold: string;
  // «أسم المنتج» — the join key everywhere. «كود الاسطمبة» (mold) is empty on
  // every one of the sheet's rows, so this is what names the row.
  product: string;
  plannedMin: number; goodUnits: number; scrapUnits: number;
  downtimeMin: number; downtimeReason: string; operator: string; note: string;
};
// From GET /api/molds (Master): `number` is the mould number — D, else the notes.
type Mold = { row: number; code?: string; name?: string; number?: string; notesNumber?: string };
// Physical machine from the registry — `label` ("PQPI 4 — 220") is the unique
// identity written to the production tab's machine-code column.
type Machine = { row: number; code: string; name: string; label: string; product: string; status: string; shiftLength: number };

export default function ProductionPage() {
  const { lang } = useLang();
  const p = pd[lang];
  const isAr = lang === "ar";
  usePageTitle(p.runs.title);

  const [runs, setRuns] = useState<Run[] | null>(null);
  const [molds, setMolds] = useState<Mold[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [period, setPeriod] = useState<"month" | "all">("month");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const ym = today.slice(0, 7);

  const blank = useCallback(
    () => ({
      date: today, shift: SHIFTS[0], machine: "", mold: "", product: "", plannedMin: "720",
      goodUnits: "", scrapUnits: "", openCavities: "", downtimeMin: "", downtimeReason: "None",
      operator: "", note: "",
    }),
    [today]
  );
  const [form, setForm] = useState(blank());

  const load = useCallback(async () => {
    // The log renders the moment /api/runs answers; the mould numbers and the
    // machine list land on their own. A cold Master read is 2–4s, and until
    // 2026-09-04 the table waited for all three.
    // Master (guarded) rather than the open «الاسطمبات» view: only Master
    // carries the notes column where 26 products keep their mould number.
    authedFetch("/api/molds").then((x) => x.json()).then((mo) => setMolds(Array.isArray(mo.molds) ? mo.molds : [])).catch(() => {});
    fetch("/api/machines").then((x) => x.json()).then((ma) => setMachines(ma.machines ?? [])).catch(() => {});
    const r = await fetch("/api/runs").then((x) => x.json()).catch(() => []);
    setRuns(Array.isArray(r) ? r : []);
  }, []);
  useEffect(() => { load(); }, [load]);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => {
      const next = { ...f, [k]: v };
      // Picking a machine (by its code label) defaults planned minutes to
      // that machine's shift length.
      if (k === "machine") {
        const mc = machines.find((m) => m.label === v);
        if (mc && mc.shiftLength > 0) next.plannedMin = String(mc.shiftLength);
      }
      // Picking a mold also records the PRODUCT NAME — OEE joins production
      // rows to Master by that name.
      if (k === "mold") {
        const md = molds.find((m) => (m.code || m.name) === v);
        next.product = md?.name ?? "";
      }
      return next;
    });
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    // Data-quality rule: downtime must carry a reason.
    if (Number(form.downtimeMin) > 0 && (!form.downtimeReason || form.downtimeReason === "None")) {
      setSaveError(p.runs.reasonRequired);
      return;
    }
    setSaving(true);
    try {
      // The production tab's machine column holds the registry LABEL
      // ("PQPI 4 — 220") — the machine's identity everywhere (board included).
      const mac = machines.find((m) => m.label === form.machine);
      const payload = { ...form, machine: mac ? mac.label : form.machine, machineCode: mac ? mac.label : "" };
      const res = await authedFetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.ok === false) throw new Error("save_failed");
      setForm(blank());
      setOpen(false);
      load();
    } catch {
      setSaveError(p.runs.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(p.common.confirmDelete)) return;
    await authedFetch(`/api/runs/${id}`, { method: "DELETE" });
    load();
  }

  const fmt = (n: number) => Number(n || 0).toLocaleString(isAr ? LOCALE_AR : "en-US");
  const moldLabel = (key: string) =>
    molds.find((m) => (m.code || m.name) === key)?.name || key || "—";
  // Until 2026-09-04 the rows were labelled by moldLabel(r.mold) alone, and
  // «كود الاسطمبة» is empty on every row of «الإنتاج» — so every row read «—».
  // The product name is what the sheet actually fills in.
  const productOf = (r: Run) => r.product || moldLabel(r.mold);
  const numberByName = useMemo(() => {
    const map = new Map<string, Mold>();
    for (const m of molds) { const k = moldKey(m.name); if (k && !map.has(k)) map.set(k, m); }
    return map;
  }, [molds]);
  const numberOf = (r: Run) => numberByName.get(moldKey(r.product))?.number || "";
  const shiftLabel = (s: string) => localize(s, SHIFTS, p.runs.shifts);

  const scope = (runs ?? []).filter((r) => (period === "all" ? true : (r.date || "").startsWith(ym)));
  const good = scope.reduce((s, r) => s + (r.goodUnits || 0), 0);
  const scrap = scope.reduce((s, r) => s + (r.scrapUnits || 0), 0);
  const downtime = scope.reduce((s, r) => s + (r.downtimeMin || 0), 0);
  const scrapRate = good + scrap ? ((scrap / (good + scrap)) * 100).toFixed(1) : "0.0";

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="max-w-5xl">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">{p.runs.title}</h1>
        <p className="text-sm text-gray-500">{p.runs.subtitle}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Btn onClick={() => { setForm(blank()); setSaveError(null); setOpen(true); }}><Plus size={15} /> {p.runs.add}</Btn>
          {/* Period toggle */}
          <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
            {(["month", "all"] as const).map((key) => (
              <button
                key={key}
                onClick={() => setPeriod(key)}
                className={`px-3 py-1.5 min-h-11 sm:min-h-0 inline-flex items-center rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
                  period === key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"
                }`}
              >
                {key === "month" ? p.runs.thisMonth : p.runs.allTime}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
        <Stat label={p.runs.totalGood} value={fmt(good)} tone="green" />
        <Stat label={p.runs.totalScrap} value={fmt(scrap)} tone={scrap > 0 ? "red" : undefined} />
        <Stat label={p.runs.scrapRate} value={`${scrapRate}%`} tone={Number(scrapRate) > 3 ? "amber" : undefined} />
        <Stat label={p.runs.totalDowntime} value={fmt(downtime)} sub={p.overview.minutes} />
      </div>

      {runs === null ? (
        <div className="flex justify-center py-16"><Spinner text={p.common.loading} /></div>
      ) : runs.length === 0 ? (
        <EmptyState text={p.runs.empty} />
      ) : (
        <>
        {/* Phone: stacked run cards */}
        <div className="md:hidden space-y-3">
          {(runs ?? []).map((r) => (
            <div key={r.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3">
              <div className="flex items-center justify-between gap-3 min-w-0">
                <span className="font-medium text-gray-900 leading-snug min-w-0 truncate">
                  {productOf(r)}
                  {numberOf(r) ? (
                    <span className="ms-2 text-xs font-normal text-gray-500 whitespace-nowrap">
                      {p.runs.moldNumber} <span dir="ltr" className="font-mono">{numberOf(r)}</span>
                    </span>
                  ) : null}
                </span>
                <button
                  onClick={() => handleDelete(r.id)}
                  aria-label={p.common.delete}
                  className="text-gray-300 hover:text-red-500 transition-colors shrink-0 p-2.5 -m-1.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {r.date}{r.shift ? ` · ${shiftLabel(r.shift)}` : ""} · {r.machineCode || r.machine || "—"}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm mt-2">
                <span className="text-green-600 font-medium">{fmt(r.goodUnits)} ✓</span>
                {r.scrapUnits ? <span className="text-red-500">{fmt(r.scrapUnits)} ✗</span> : null}
                {r.downtimeMin ? (
                  <span className="text-gray-500">
                    {fmt(r.downtimeMin)} {p.overview.minutes}
                    {r.downtimeReason && r.downtimeReason !== "None"
                      ? ` · ${localize(r.downtimeReason, DOWNTIME_REASONS, p.runs.reasons)}`
                      : ""}
                  </span>
                ) : null}
              </div>
              {r.operator ? <div className="text-xs text-gray-400 mt-1">{r.operator}</div> : null}
            </div>
          ))}
        </div>
        {/* Desktop: the table */}
        <div className="hidden md:block bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/50">
                <th className="text-start px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{p.runs.date}</th>
                <th className="text-start px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{p.runs.shift}</th>
                <th className="text-start px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{p.runs.mold}</th>
                <th className="text-start px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{p.runs.moldNumber}</th>
                <th className="text-start px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{p.runs.machine}</th>
                <th className="text-end px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{p.runs.good}</th>
                <th className="text-end px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{p.runs.scrap}</th>
                <th className="text-start px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{p.runs.downtime}</th>
                <th className="text-start px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{p.runs.operator}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(runs ?? []).map((r) => (
                <tr key={r.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap tabular-nums" dir="ltr">{r.date}</td>
                  <td className="px-4 py-3 text-gray-500">{r.shift ? shiftLabel(r.shift) : "—"}</td>
                  <td className="px-4 py-3 font-medium text-gray-800">{productOf(r)}</td>
                  <td className="px-4 py-3 text-gray-600 font-mono tabular-nums whitespace-nowrap" dir="ltr">{numberOf(r) || "—"}</td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap" dir="ltr">{r.machineCode || r.machine || "—"}</td>
                  <td className="px-4 py-3 text-green-600 font-medium text-end tabular-nums">{fmt(r.goodUnits)}</td>
                  <td className="px-4 py-3 text-red-500 text-end tabular-nums">{r.scrapUnits ? fmt(r.scrapUnits) : "—"}</td>
                  <td className="px-4 py-3 text-gray-500 tabular-nums">
                    {r.downtimeMin ? `${fmt(r.downtimeMin)} ${p.overview.minutes}` : "—"}
                    {r.downtimeMin && r.downtimeReason && r.downtimeReason !== "None"
                      ? ` · ${localize(r.downtimeReason, DOWNTIME_REASONS, p.runs.reasons)}`
                      : ""}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{r.operator || "—"}</td>
                  <td className="px-4 py-3 text-end">
                    <button
                      onClick={() => handleDelete(r.id)}
                      aria-label={p.common.delete}
                      className="min-w-9 min-h-9 inline-flex items-center justify-center rounded-lg text-gray-300 hover:text-red-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
        </>
      )}

      {/* Log production modal */}
      <Modal open={open} title={p.runs.add} onClose={() => setOpen(false)} isAr={isAr}>
        <form onSubmit={handleAdd}>
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
              <select className={inputCls} required value={form.machine} onChange={(e) => set("machine", e.target.value)}>
                <option value="">{p.common.select}</option>
                {machines.map((m) => (
                  <option key={m.row} value={m.label}>
                    {m.label}{m.product ? ` · ${m.product}` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={p.runs.mold}>
              <select className={inputCls} required value={form.mold} onChange={(e) => set("mold", e.target.value)}>
                <option value="">{p.common.select}</option>
                {molds.map((m) => {
                  const v = m.code || m.name || "";
                  return <option key={m.row} value={v}>{m.name || v}</option>;
                })}
              </select>
            </Field>
            <Field label={p.runs.planned}>
              <input className={inputCls} type="number" min="0" value={form.plannedMin} onChange={(e) => set("plannedMin", e.target.value)} />
            </Field>
            <Field label={p.runs.good}>
              <input className={inputCls} type="number" min="0" required value={form.goodUnits} onChange={(e) => set("goodUnits", e.target.value)} />
            </Field>
            <Field label={p.runs.scrap}>
              <input className={inputCls} type="number" min="0" value={form.scrapUnits} onChange={(e) => set("scrapUnits", e.target.value)} />
            </Field>
            <Field label={p.runs.openCav}>
              <input className={inputCls} type="number" min="1" value={form.openCavities} onChange={(e) => set("openCavities", e.target.value)} />
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
          {saveError && <p className="text-xs text-red-600 mt-1">{saveError}</p>}
          <div className="flex flex-wrap items-center gap-3 mt-2">
            <Btn type="submit" disabled={saving}>{p.common.save}</Btn>
            <Btn type="button" variant="outline" onClick={() => setOpen(false)}>{p.common.cancel}</Btn>
          </div>
        </form>
      </Modal>
    </div>
  );
}
