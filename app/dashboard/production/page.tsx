"use client";
import { useLang } from "@/context/LangContext";
import { pd } from "@/lib/i18n.prod";
import { useEffect, useState, useCallback } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Stat, Field, inputCls, Btn, Modal, EmptyState, Spinner } from "@/components/dashboard/ui";
import { DOWNTIME_REASONS, SHIFTS, localize, options } from "@/lib/prod-meta";

type Run = {
  id: string; date: string; shift: string; machine: string; machineCode: string; mold: string;
  plannedMin: number; goodUnits: number; scrapUnits: number;
  downtimeMin: number; downtimeReason: string; operator: string; note: string;
};
type Mold = { row: number; code?: string; name?: string };
// Physical machine from the registry — `label` ("PQPI 4 — 220") is the unique
// identity written to the production tab's machine-code column.
type Machine = { row: number; code: string; name: string; label: string; product: string; status: string; shiftLength: number };

export default function ProductionPage() {
  const { lang } = useLang();
  const p = pd[lang];
  const isAr = lang === "ar";

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
    const [r, mo, ma] = await Promise.all([
      fetch("/api/runs").then((x) => x.json()).catch(() => []),
      fetch("/api/sheet/molds").then((x) => x.json()).catch(() => ({ records: [] })),
      fetch("/api/machines").then((x) => x.json()).catch(() => ({ machines: [] })),
    ]);
    setRuns(Array.isArray(r) ? r : []);
    setMolds(mo.records ?? []);
    setMachines(ma.machines ?? []);
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
      // Picking a mold also records the PRODUCT NAME — the sheet's hourly
      // board and OEE both join production rows to Master by that name.
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
      const res = await fetch("/api/runs", {
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
    await fetch(`/api/runs/${id}`, { method: "DELETE" });
    load();
  }

  const fmt = (n: number) => Number(n || 0).toLocaleString(isAr ? "ar-EG" : "en-US");
  const moldLabel = (key: string) =>
    molds.find((m) => (m.code || m.name) === key)?.name || key || "—";
  const shiftLabel = (s: string) => localize(s, SHIFTS, p.runs.shifts);

  const scope = (runs ?? []).filter((r) => (period === "all" ? true : (r.date || "").startsWith(ym)));
  const good = scope.reduce((s, r) => s + (r.goodUnits || 0), 0);
  const scrap = scope.reduce((s, r) => s + (r.scrapUnits || 0), 0);
  const downtime = scope.reduce((s, r) => s + (r.downtimeMin || 0), 0);
  const scrapRate = good + scrap ? ((scrap / (good + scrap)) * 100).toFixed(1) : "0.0";

  return (
    <div className="max-w-5xl">
      <div className={`flex items-center justify-between mb-1 ${isAr ? "flex-row-reverse" : ""}`}>
        <h1 className="text-2xl font-bold text-gray-900">{p.runs.title}</h1>
        <Btn onClick={() => { setForm(blank()); setSaveError(null); setOpen(true); }}><Plus size={15} /> {p.runs.add}</Btn>
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
        <>
        {/* Phone: stacked run cards */}
        <div className="md:hidden space-y-2" dir={isAr ? "rtl" : "ltr"}>
          {(runs ?? []).map((r) => (
            <div key={r.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-gray-900 leading-snug">{moldLabel(r.mold)}</span>
                <button
                  onClick={() => handleDelete(r.id)}
                  className="text-gray-300 hover:text-red-500 transition-colors shrink-0 p-1 -m-1"
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
        {/* Desktop: the table, unchanged */}
        <div className="hidden md:block bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm" dir={isAr ? "rtl" : "ltr"}>
            <thead>
              <tr className="text-gray-500 border-b border-gray-100 text-xs uppercase tracking-wide">
                <th className="text-start font-medium px-4 py-3">{p.runs.date}</th>
                <th className="text-start font-medium px-4 py-3">{p.runs.shift}</th>
                <th className="text-start font-medium px-4 py-3">{p.runs.mold}</th>
                <th className="text-start font-medium px-4 py-3">{p.runs.machine}</th>
                <th className="text-start font-medium px-4 py-3">{p.runs.good}</th>
                <th className="text-start font-medium px-4 py-3">{p.runs.scrap}</th>
                <th className="text-start font-medium px-4 py-3">{p.runs.downtime}</th>
                <th className="text-start font-medium px-4 py-3">{p.runs.operator}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(runs ?? []).map((r) => (
                <tr key={r.id} className="hover:bg-gray-50/60">
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{r.date}</td>
                  <td className="px-4 py-3 text-gray-500">{r.shift ? shiftLabel(r.shift) : "—"}</td>
                  <td className="px-4 py-3 font-medium text-gray-800">{moldLabel(r.mold)}</td>
                  <td className="px-4 py-3 text-gray-500">{r.machineCode || r.machine || "—"}</td>
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
          <div className={`flex gap-3 mt-2 ${isAr ? "flex-row-reverse" : ""}`}>
            <Btn type="submit" disabled={saving}>{p.common.save}</Btn>
            <Btn type="button" variant="outline" onClick={() => setOpen(false)}>{p.common.cancel}</Btn>
          </div>
        </form>
      </Modal>
    </div>
  );
}
