"use client";
import { useEffect, useState, useCallback } from "react";
import { useLang } from "@/context/LangContext";
import { ad } from "@/lib/i18n.auth";
import { pd } from "@/lib/i18n.prod";
import { DOWNTIME_REASONS, SHIFTS, localize, options } from "@/lib/prod-meta";
import { Stat, Field, inputCls, Btn, Modal, Spinner, EmptyState } from "@/components/dashboard/ui";
import { Plus } from "lucide-react";

type Run = {
  id: string; date: string; shift: string; machine: string; machineCode: string; mold: string;
  plannedMin: number; goodUnits: number; scrapUnits: number;
  downtimeMin: number; downtimeReason: string; operator: string; note: string;
};
type Machine = { row: number; code: string; name: string; label: string; product: string; status: string; shiftLength: number };
type Mold = { row: number; code?: string; name?: string };

export default function QualityPage() {
  const { lang } = useLang();
  const a = ad[lang];
  const p = pd[lang];
  const isAr = lang === "ar";
  const today = new Date().toISOString().slice(0, 10);

  const [date, setDate] = useState(today);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [molds, setMolds] = useState<Mold[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const blank = useCallback(
    () => ({
      date, shift: SHIFTS[0], machine: "", mold: "", product: "", plannedMin: "720",
      goodUnits: "", scrapUnits: "", openCavities: "", downtimeMin: "", downtimeReason: "None",
      operator: "", note: "",
    }),
    [date]
  );
  const [form, setForm] = useState(blank());

  const load = useCallback(async () => {
    const [r, m, mo] = await Promise.all([
      fetch("/api/runs").then((x) => x.json()).catch(() => []),
      fetch("/api/machines").then((x) => x.json()).catch(() => ({ machines: [] })),
      fetch("/api/sheet/molds").then((x) => x.json()).catch(() => ({ records: [] })),
    ]);
    setRuns(Array.isArray(r) ? r : []);
    setMachines(m.machines ?? []);
    setMolds(mo.records ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => {
      const next = { ...f, [k]: v };
      if (k === "machine") {
        const mc = machines.find((m) => m.label === v);
        if (mc && mc.shiftLength > 0) next.plannedMin = String(mc.shiftLength);
      }
      if (k === "mold") {
        const md = molds.find((m) => (m.code || m.name) === v);
        next.product = md?.name ?? "";
      }
      return next;
    });
  }
  function openLog() { setForm({ ...blank(), date }); setSaveError(null); setOpen(true); }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    if (Number(form.downtimeMin) > 0 && (!form.downtimeReason || form.downtimeReason === "None")) {
      setSaveError(p.runs.reasonRequired);
      return;
    }
    setSaving(true);
    try {
      // machine column = registry label (the machine's identity everywhere)
      const mac = machines.find((m) => m.label === form.machine);
      const payload = { ...form, machine: mac ? mac.label : form.machine, machineCode: mac ? mac.label : "" };
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.ok === false) throw new Error("save_failed");
      setOpen(false);
      load();
    } catch {
      setSaveError(p.runs.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  const fmt = (n: number) => Number(n || 0).toLocaleString(isAr ? "ar-EG" : "en-US");
  const moldLabel = (key: string) =>
    molds.find((m) => (m.code || m.name) === key)?.name || key || "—";
  const shiftLabel = (s: string) => localize(s, SHIFTS, p.runs.shifts);

  if (runs === null) return <Spinner text={a.quality.title} />;

  const dayRuns = runs.filter((r) => r.date === date);
  const good = dayRuns.reduce((s, r) => s + (r.goodUnits || 0), 0);
  const scrap = dayRuns.reduce((s, r) => s + (r.scrapUnits || 0), 0);
  const downtime = dayRuns.reduce((s, r) => s + (r.downtimeMin || 0), 0);
  const scrapRate = good + scrap ? ((scrap / (good + scrap)) * 100).toFixed(1) : "0.0";

  return (
    <div className="max-w-5xl">
      <div className={`flex items-center justify-between mb-1 ${isAr ? "flex-row-reverse" : ""}`}>
        <h1 className="text-2xl font-bold text-gray-900">{a.quality.title}</h1>
        <Btn onClick={openLog}><Plus size={15} /> {a.quality.add}</Btn>
      </div>
      <p className="text-sm text-gray-500 mb-6">{a.quality.subtitle}</p>

      <div className={`flex items-center gap-2 mb-6 ${isAr ? "flex-row-reverse" : ""}`}>
        <label className="text-sm text-gray-600">{a.quality.date}</label>
        <input type="date" className={`${inputCls} w-auto`} value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Stat label={a.quality.dayGood} value={fmt(good)} tone="green" />
        <Stat label={a.quality.dayScrap} value={fmt(scrap)} tone={scrap > 0 ? "red" : undefined} />
        <Stat label={a.quality.dayScrapRate} value={`${scrapRate}%`} tone={Number(scrapRate) > 3 ? "amber" : undefined} />
        <Stat label={a.quality.dayDowntime} value={`${fmt(downtime)} ${a.quality.min}`} />
      </div>

      {dayRuns.length === 0 ? (
        <EmptyState text={a.quality.noEntries} />
      ) : (
        <>
        {/* Phone: stacked entry cards */}
        <div className="md:hidden space-y-2" dir={isAr ? "rtl" : "ltr"}>
          {dayRuns.map((r) => {
            const tot = (r.goodUnits || 0) + (r.scrapUnits || 0);
            const rate = tot ? ((r.scrapUnits / tot) * 100).toFixed(1) : "0.0";
            return (
              <div key={r.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-gray-900 leading-snug">{r.machineCode || r.machine || "—"}</span>
                  <span className={`text-xs font-medium shrink-0 ${Number(rate) > 3 ? "text-amber-600" : "text-gray-400"}`}>
                    {rate}%
                  </span>
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {moldLabel(r.mold)}{r.shift ? ` · ${shiftLabel(r.shift)}` : ""}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm mt-2">
                  <span className="text-green-600 font-medium">{fmt(r.goodUnits)} ✓</span>
                  {r.scrapUnits ? <span className="text-red-500">{fmt(r.scrapUnits)} ✗</span> : null}
                  {r.downtimeMin ? (
                    <span className="text-gray-500">
                      {fmt(r.downtimeMin)} {a.quality.min}
                      {r.downtimeReason && r.downtimeReason !== "None"
                        ? ` · ${localize(r.downtimeReason, DOWNTIME_REASONS, p.runs.reasons)}`
                        : ""}
                    </span>
                  ) : null}
                </div>
                {r.operator ? <div className="text-xs text-gray-400 mt-1">{r.operator}</div> : null}
              </div>
            );
          })}
        </div>
        {/* Desktop: the table, unchanged */}
        <div className="hidden md:block bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm" dir={isAr ? "rtl" : "ltr"}>
            <thead>
              <tr className="text-gray-500 border-b border-gray-100 text-xs uppercase tracking-wide">
                <th className="text-start font-medium px-4 py-3">{a.quality.machine}</th>
                <th className="text-start font-medium px-4 py-3">{p.runs.mold}</th>
                <th className="text-start font-medium px-4 py-3">{p.runs.shift}</th>
                <th className="text-start font-medium px-4 py-3">{a.quality.good}</th>
                <th className="text-start font-medium px-4 py-3">{a.quality.scrap}</th>
                <th className="text-start font-medium px-4 py-3">{a.quality.scrapRate}</th>
                <th className="text-start font-medium px-4 py-3">{a.quality.downtime}</th>
                <th className="text-start font-medium px-4 py-3">{a.quality.operator}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {dayRuns.map((r) => {
                const tot = (r.goodUnits || 0) + (r.scrapUnits || 0);
                const rate = tot ? ((r.scrapUnits / tot) * 100).toFixed(1) : "0.0";
                return (
                  <tr key={r.id} className="hover:bg-gray-50/60">
                    <td className="px-4 py-3 font-medium text-gray-900">{r.machineCode || r.machine || "—"}</td>
                    <td className="px-4 py-3 text-gray-500">{moldLabel(r.mold)}</td>
                    <td className="px-4 py-3 text-gray-500">{r.shift ? shiftLabel(r.shift) : "—"}</td>
                    <td className="px-4 py-3 text-green-600 font-medium">{fmt(r.goodUnits)}</td>
                    <td className="px-4 py-3 text-red-500">{r.scrapUnits ? fmt(r.scrapUnits) : "—"}</td>
                    <td className={`px-4 py-3 ${Number(rate) > 3 ? "text-amber-600" : "text-gray-500"}`}>{rate}%</td>
                    <td className="px-4 py-3 text-gray-500">
                      {r.downtimeMin ? `${fmt(r.downtimeMin)} ${a.quality.min}` : "—"}
                      {r.downtimeMin && r.downtimeReason && r.downtimeReason !== "None"
                        ? ` · ${localize(r.downtimeReason, DOWNTIME_REASONS, p.runs.reasons)}`
                        : ""}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{r.operator || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      <Modal open={open} title={a.quality.add} onClose={() => setOpen(false)} isAr={isAr}>
        <form onSubmit={handleAdd}>
          <div className="grid sm:grid-cols-2 gap-x-4">
            <Field label={a.quality.date}>
              <input className={inputCls} type="date" required value={form.date} onChange={(e) => set("date", e.target.value)} />
            </Field>
            <Field label={p.runs.shift}>
              <select className={inputCls} value={form.shift} onChange={(e) => set("shift", e.target.value)}>
                {options(SHIFTS, p.runs.shifts).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>
            <Field label={a.quality.machine}>
              <select className={inputCls} required value={form.machine} onChange={(e) => set("machine", e.target.value)}>
                <option value="">{p.common.select}</option>
                {machines.map((m) => (<option key={m.row} value={m.label}>{m.label}{m.product ? ` · ${m.product}` : ""}</option>))}
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
            <Field label={a.quality.good}>
              <input className={inputCls} type="number" min="0" required value={form.goodUnits} onChange={(e) => set("goodUnits", e.target.value)} />
            </Field>
            <Field label={a.quality.scrap}>
              <input className={inputCls} type="number" min="0" value={form.scrapUnits} onChange={(e) => set("scrapUnits", e.target.value)} />
            </Field>
            <Field label={p.runs.openCav}>
              <input className={inputCls} type="number" min="1" value={form.openCavities} onChange={(e) => set("openCavities", e.target.value)} />
            </Field>
            <Field label={a.quality.downtime}>
              <input className={inputCls} type="number" min="0" value={form.downtimeMin} onChange={(e) => set("downtimeMin", e.target.value)} />
            </Field>
            <Field label={a.quality.reason}>
              <select className={inputCls} value={form.downtimeReason} onChange={(e) => set("downtimeReason", e.target.value)}>
                {options(DOWNTIME_REASONS, p.runs.reasons).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>
            <Field label={a.quality.operator}>
              <input className={inputCls} value={form.operator} onChange={(e) => set("operator", e.target.value)} />
            </Field>
          </div>
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
