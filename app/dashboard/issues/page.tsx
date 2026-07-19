"use client";
import { useEffect, useMemo, useState } from "react";
import { useLang } from "@/context/LangContext";
import { pd } from "@/lib/i18n.prod";
import { Plus } from "lucide-react";
import { Field, inputCls, Btn, Modal, Spinner, EmptyState, Stat } from "@/components/dashboard/ui";

type Issue = {
  row: number; date: string; machine: string; product: string; category: string;
  description: string; action: string; status: string; note: string;
};
type Machine = { label: string; status: string };

const CATS = ["خامة", "اسطمبة", "ماكينة", "كهرباء", "أخرى"];
const STATUSES = ["مفتوح", "قيد التنفيذ", "تم"];
const NEXT_STATUS: Record<string, string> = { "مفتوح": "قيد التنفيذ", "قيد التنفيذ": "تم", "تم": "مفتوح" };

const statusCls = (s: string) =>
  s === "تم"
    ? "border-green-200 bg-green-50 text-green-700"
    : s === "قيد التنفيذ"
    ? "border-amber-300 bg-amber-50 text-amber-700"
    : "border-red-200 bg-red-50 text-red-700";

const today = () => new Date().toISOString().slice(0, 10);

export default function IssuesPage() {
  const { lang } = useLang();
  const p = pd[lang];
  const t = p.issues;
  const isAr = lang === "ar";

  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [products, setProducts] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const blank = () => ({
    date: today(), machine: "", product: "", category: CATS[0],
    description: "", action: "", status: "مفتوح", note: "",
  });
  const [form, setForm] = useState(blank());
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function load() {
    try {
      const j = await (await fetch("/api/issues")).json();
      if (Array.isArray(j.issues)) setIssues(j.issues);
      else if (issues === null) setIssues([]);
    } catch { if (issues === null) setIssues([]); }
  }
  useEffect(() => {
    load();
    fetch("/api/machines").then((r) => r.json())
      .then((m) => setMachines(m.machines ?? [])).catch(() => {});
    fetch("/api/sheet/products").then((r) => r.json())
      .then((d) => setProducts(((d.records ?? []) as { name?: string }[]).map((x) => x.name || "").filter(Boolean)))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const id = setInterval(() => { if (!open && !document.hidden) load(); }, 30000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!form.description.trim()) { setSaveError(t.descRequired); return; }
    setSaving(true); setSaveError(null);
    try {
      const res = await fetch("/api/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) { setSaveError(t.saveFailed); setSaving(false); return; }
      setSaving(false); setOpen(false); setForm(blank());
      load();
    } catch { setSaveError(t.saveFailed); setSaving(false); }
  }

  // Tap a status pill → advance it (optimistic; reverts on failure).
  async function cycleStatus(issue: Issue) {
    const next = NEXT_STATUS[issue.status] || "مفتوح";
    setIssues((list) => (list ?? []).map((i) => (i.row === issue.row ? { ...i, status: next } : i)));
    try {
      const res = await fetch("/api/sheet/issues", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ row: issue.row, changes: { status: next } }),
      });
      const j = await res.json().catch(() => ({ ok: false }));
      if (!j.ok) throw new Error();
    } catch {
      setIssues((list) => (list ?? []).map((i) => (i.row === issue.row ? { ...i, status: issue.status } : i)));
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (issues ?? []).filter((i) => {
      if (statusFilter && i.status !== statusFilter) return false;
      if (!q) return true;
      return [i.machine, i.product, i.category, i.description, i.action, i.note]
        .some((v) => (v || "").toLowerCase().includes(q));
    });
  }, [issues, statusFilter, query]);

  const openCount = (issues ?? []).filter((i) => i.status !== "تم").length;

  const StatusPill = ({ issue }: { issue: Issue }) => (
    <button
      onClick={() => cycleStatus(issue)}
      title={t.tapStatus}
      className={`shrink-0 text-xs px-2.5 py-1 rounded-full border whitespace-nowrap transition-colors ${statusCls(issue.status)}`}
    >
      {t.statusLabels[issue.status] || issue.status}
    </button>
  );

  return (
    <div className="max-w-5xl" dir={isAr ? "rtl" : "ltr"}>
      <div className={`flex items-center justify-between gap-3 mb-1`}>
        <h1 className="text-2xl font-bold text-gray-900">{t.title}</h1>
        <Btn onClick={() => { setForm(blank()); setSaveError(null); setOpen(true); }}>
          <Plus size={15} /> {t.add}
        </Btn>
      </div>
      <p className="text-sm text-gray-500 mb-5">{t.subtitle}</p>

      <div className="grid grid-cols-2 gap-4 mb-5 max-w-sm">
        <Stat label={t.open} value={openCount} tone={openCount > 0 ? "amber" : "green"} />
        <Stat label={t.all} value={(issues ?? []).length} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
          {["", ...STATUSES].map((s) => (
            <button
              key={s || "all"}
              onClick={() => setStatusFilter(s)}
              className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                statusFilter === s ? "bg-blue-600 text-white" : "text-gray-500 hover:text-gray-900"
              }`}
            >
              {s ? (t.statusLabels[s] || s) : t.all}
            </button>
          ))}
        </div>
        <input
          className={`${inputCls} w-full sm:w-64`}
          placeholder={t.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {issues === null ? (
        <Spinner text={p.common.loading} />
      ) : filtered.length === 0 ? (
        <EmptyState text={t.empty} />
      ) : (
        <>
          {/* Phone: stacked cards */}
          <div className="md:hidden space-y-2">
            {filtered.map((i) => (
              <div key={i.row} className="bg-white border border-gray-200 rounded-xl px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-gray-900 leading-snug">
                    {i.machine || i.product || "—"}
                  </span>
                  <StatusPill issue={i} />
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {i.date}{i.category ? ` · ${t.catLabels[i.category] || i.category}` : ""}
                  {i.machine && i.product ? ` · ${i.product}` : ""}
                </div>
                <p className="text-sm text-gray-700 mt-2 leading-relaxed">{i.description}</p>
                {i.action ? <p className="text-xs text-blue-700 mt-1.5">↳ {i.action}</p> : null}
                {i.note ? <p className="text-xs text-gray-400 mt-1">{i.note}</p> : null}
              </div>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden md:block bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm" dir={isAr ? "rtl" : "ltr"}>
              <thead>
                <tr className="text-gray-500 border-b border-gray-100 text-xs uppercase tracking-wide">
                  <th className="text-start font-medium px-4 py-3">{t.date}</th>
                  <th className="text-start font-medium px-4 py-3">{t.machine}</th>
                  <th className="text-start font-medium px-4 py-3">{t.product}</th>
                  <th className="text-start font-medium px-4 py-3">{t.category}</th>
                  <th className="text-start font-medium px-4 py-3">{t.description}</th>
                  <th className="text-start font-medium px-4 py-3">{t.action}</th>
                  <th className="text-start font-medium px-4 py-3">{t.status}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((i) => (
                  <tr key={i.row} className="hover:bg-gray-50/60 align-top">
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{i.date}</td>
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{i.machine || "—"}</td>
                    <td className="px-4 py-3 text-gray-600">{i.product || "—"}</td>
                    <td className="px-4 py-3 text-gray-500">{i.category ? (t.catLabels[i.category] || i.category) : "—"}</td>
                    <td className="px-4 py-3 text-gray-700 max-w-md">{i.description}</td>
                    <td className="px-4 py-3 text-gray-500 max-w-xs">{i.action || "—"}</td>
                    <td className="px-4 py-3"><StatusPill issue={i} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Log-issue modal */}
      <Modal open={open} title={t.add} onClose={() => setOpen(false)} isAr={isAr}>
        <form onSubmit={handleAdd}>
          <div className="grid sm:grid-cols-2 gap-x-4">
            <Field label={t.date}>
              <input className={inputCls} type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
            </Field>
            <Field label={t.category}>
              <select className={inputCls} value={form.category} onChange={(e) => set("category", e.target.value)}>
                {CATS.map((c) => <option key={c} value={c}>{t.catLabels[c] || c}</option>)}
              </select>
            </Field>
            <Field label={t.machine}>
              <select className={inputCls} value={form.machine} onChange={(e) => set("machine", e.target.value)}>
                <option value="">—</option>
                {machines.map((m) => <option key={m.label} value={m.label}>{m.label}</option>)}
              </select>
            </Field>
            <Field label={t.product}>
              <input className={inputCls} list="issue-products" value={form.product} onChange={(e) => set("product", e.target.value)} />
              <datalist id="issue-products">
                {products.slice(0, 500).map((n) => <option key={n} value={n} />)}
              </datalist>
            </Field>
          </div>
          <Field label={t.description}>
            <textarea className={`${inputCls} resize-none`} rows={3} required value={form.description}
              onChange={(e) => set("description", e.target.value)} />
          </Field>
          <Field label={t.action}>
            <textarea className={`${inputCls} resize-none`} rows={2} value={form.action}
              onChange={(e) => set("action", e.target.value)} />
          </Field>
          <Field label={t.note}>
            <input className={inputCls} value={form.note} onChange={(e) => set("note", e.target.value)} />
          </Field>
          {saveError && <p className="text-sm text-red-600 mb-2">{saveError}</p>}
          <div className={`flex gap-3 mt-2`}>
            <Btn type="submit" disabled={saving}>{saving ? "…" : t.add}</Btn>
            <Btn type="button" variant="outline" onClick={() => setOpen(false)}>{p.common.cancel ?? "✕"}</Btn>
          </div>
        </form>
      </Modal>
    </div>
  );
}
