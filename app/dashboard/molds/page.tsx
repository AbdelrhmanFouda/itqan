"use client";
import { useLang } from "@/context/LangContext";
import { pd } from "@/lib/i18n.prod";
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Pill, Field, inputCls, Btn, Modal, EmptyState, Spinner } from "@/components/dashboard/ui";
import { MOLD_STATUSES, moldTone, localize, options } from "@/lib/prod-meta";

type Mold = {
  id: string;
  code: string;
  partName: string;
  client: string;
  cavities: number;
  material: string;
  cycleTimeSec: number;
  status: string;
  location: string;
};

const empty = {
  code: "",
  partName: "",
  client: "",
  cavities: "",
  material: "",
  cycleTimeSec: "",
  status: "Active",
  location: "",
};

export default function MoldsPage() {
  const { lang } = useLang();
  const p = pd[lang];
  const isAr = lang === "ar";
  const [molds, setMolds] = useState<Mold[] | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);

  async function load() {
    const res = await fetch("/api/molds");
    if (res.ok) setMolds(await res.json());
    else setMolds([]);
  }
  useEffect(() => { load(); }, []);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch("/api/molds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setForm({ ...empty });
    setOpen(false);
    setSaving(false);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm(p.common.confirmDelete)) return;
    await fetch(`/api/molds/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="max-w-5xl">
      <div className={`flex items-center justify-between mb-1 ${isAr ? "flex-row-reverse" : ""}`}>
        <h1 className="text-2xl font-bold text-gray-900">{p.molds.title}</h1>
        <Btn onClick={() => setOpen(true)}><Plus size={15} /> {p.molds.add}</Btn>
      </div>
      <p className="text-sm text-gray-500 mb-6">{p.molds.subtitle}</p>

      {molds === null ? (
        <Spinner text={p.common.loading} />
      ) : molds.length === 0 ? (
        <EmptyState text={p.molds.empty} />
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm" dir={isAr ? "rtl" : "ltr"}>
            <thead>
              <tr className="text-gray-500 border-b border-gray-100 text-xs uppercase tracking-wide">
                <th className="text-start font-medium px-4 py-3">{p.molds.code}</th>
                <th className="text-start font-medium px-4 py-3">{p.molds.part}</th>
                <th className="text-start font-medium px-4 py-3">{p.molds.client}</th>
                <th className="text-start font-medium px-4 py-3">{p.molds.cavities}</th>
                <th className="text-start font-medium px-4 py-3">{p.molds.material}</th>
                <th className="text-start font-medium px-4 py-3">{p.molds.cycleTime}</th>
                <th className="text-start font-medium px-4 py-3">{p.molds.status}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {molds.map((m) => (
                <tr key={m.id} className="hover:bg-gray-50/60">
                  <td className="px-4 py-3 font-medium text-gray-900">{m.code}</td>
                  <td className="px-4 py-3 text-gray-700">{m.partName}</td>
                  <td className="px-4 py-3 text-gray-500">{m.client}</td>
                  <td className="px-4 py-3 text-gray-700">{m.cavities}</td>
                  <td className="px-4 py-3 text-gray-500">{m.material}</td>
                  <td className="px-4 py-3 text-gray-500">{m.cycleTimeSec || "—"}</td>
                  <td className="px-4 py-3">
                    <Pill text={localize(m.status, MOLD_STATUSES, p.molds.statuses)} tone={moldTone(m.status)} />
                  </td>
                  <td className="px-4 py-3 text-end">
                    <button onClick={() => handleDelete(m.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} title={p.molds.add} onClose={() => setOpen(false)} isAr={isAr}>
        <form onSubmit={handleAdd}>
          <div className="grid sm:grid-cols-2 gap-x-4">
            <Field label={p.molds.code}>
              <input className={inputCls} required value={form.code} placeholder={p.molds.placeholderCode} onChange={(e) => set("code", e.target.value)} />
            </Field>
            <Field label={p.molds.part}>
              <input className={inputCls} required value={form.partName} placeholder={p.molds.placeholderPart} onChange={(e) => set("partName", e.target.value)} />
            </Field>
            <Field label={p.molds.client}>
              <input className={inputCls} value={form.client} onChange={(e) => set("client", e.target.value)} />
            </Field>
            <Field label={p.molds.material}>
              <input className={inputCls} value={form.material} onChange={(e) => set("material", e.target.value)} />
            </Field>
            <Field label={p.molds.cavities}>
              <input className={inputCls} type="number" min="0" value={form.cavities} onChange={(e) => set("cavities", e.target.value)} />
            </Field>
            <Field label={p.molds.cycleTime}>
              <input className={inputCls} type="number" min="0" value={form.cycleTimeSec} onChange={(e) => set("cycleTimeSec", e.target.value)} />
            </Field>
            <Field label={p.molds.status}>
              <select className={inputCls} value={form.status} onChange={(e) => set("status", e.target.value)}>
                {options(MOLD_STATUSES, p.molds.statuses).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>
            <Field label={p.molds.location}>
              <input className={inputCls} value={form.location} onChange={(e) => set("location", e.target.value)} />
            </Field>
          </div>
          <div className={`flex gap-3 mt-2 ${isAr ? "flex-row-reverse" : ""}`}>
            <Btn type="submit" disabled={saving}>{p.common.save}</Btn>
            <Btn type="button" variant="outline" onClick={() => setOpen(false)}>{p.common.cancel}</Btn>
          </div>
        </form>
      </Modal>
    </div>
  );
}
