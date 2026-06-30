"use client";
import { useEffect, useState } from "react";
import { useLang } from "@/context/LangContext";
import { mr } from "@/lib/i18n.register";
import { Field, inputCls, Btn, Modal, Spinner, EmptyState } from "@/components/dashboard/ui";

type Rec = { row: number } & Record<string, string>;
type Payload = {
  records: Rec[];
  fields: string[];
  longFields: string[];
  labels: Record<string, { en: string; ar: string }>;
  configured: boolean;
  writable: boolean;
};

/**
 * Generic dashboard section backed by one tab of the Google Sheet.
 * Column labels come from the sheet headers (bilingual), so it adapts to any tab.
 */
export default function SheetSection({
  entity, title, subtitle, columns = 3,
}: {
  entity: string;
  title: { en: string; ar: string };
  subtitle: { en: string; ar: string };
  columns?: number;
}) {
  const { lang } = useLang();
  const m = mr[lang];
  const isAr = lang === "ar";

  const [data, setData] = useState<Payload | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Rec | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  async function load(initial = false) {
    try {
      const res = await fetch(`/api/sheet/${entity}`);
      const json = await res.json();
      setData((prev) =>
        !initial && prev && prev.records.length > 0 && (json?.records?.length ?? 0) === 0 ? prev : json
      );
    } catch {
      /* keep current data on a transient error */
    }
  }
  useEffect(() => { setData(null); load(true); }, [entity]);
  // Auto-refresh so sheet edits appear without a manual reload (paused while editing).
  useEffect(() => {
    const id = setInterval(() => { if (!editing) load(); }, 20000);
    return () => clearInterval(id);
  }, [editing, entity]);

  const label = (f: string) => {
    const l = data?.labels?.[f];
    return l ? (isAr ? l.ar : l.en) : f;
  };

  function openEdit(rec: Rec) {
    const f: Record<string, string> = {};
    for (const key of data?.fields ?? []) f[key] = String(rec[key] ?? "");
    setForm(f); setSaveMsg(""); setEditing(rec);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editing || !data?.writable) return;
    setSaving(true); setSaveMsg("");
    // Only send fields the user actually changed, so untouched cells (and the
    // authoritative Master values) are never overwritten.
    const changes: Record<string, string> = {};
    for (const key of data.fields) {
      const next = form[key] ?? "";
      if (next !== String(editing[key] ?? "")) changes[key] = next;
    }
    if (Object.keys(changes).length === 0) { setSaving(false); setEditing(null); return; }
    const res = await fetch(`/api/sheet/${entity}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ row: editing.row, changes }),
    });
    const json = await res.json().catch(() => ({ ok: false }));
    setSaving(false);
    if (json.ok) {
      setData((d) => (d ? { ...d, records: d.records.map((r) => (r.row === editing.row ? { ...r, ...changes } : r)) } : d));
      setEditing(null);
    } else {
      setSaveMsg(`${m.saveFailed}${json.reason ? ` · ${json.reason}` : ""}`);
    }
  }

  if (data === null) return <Spinner text={m.loading} />;

  const t = isAr ? title.ar : title.en;
  const sub = isAr ? subtitle.ar : subtitle.en;

  if (!data.configured) {
    return (
      <div className="max-w-2xl" dir={isAr ? "rtl" : "ltr"}>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">{t}</h1>
        <p className="text-sm text-gray-500 mb-6">{sub}</p>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
          <p className="font-semibold text-amber-900 mb-1">{m.notConfigured}</p>
          <p className="text-sm text-amber-800 leading-relaxed">{m.notConfiguredBody}</p>
        </div>
      </div>
    );
  }

  const cols = data.fields.slice(0, columns);
  const q = query.trim().toLowerCase();
  const filtered = data.records.filter((r) => !q || data.fields.some((f) => (r[f] || "").toLowerCase().includes(q)));

  return (
    <div className="max-w-5xl" dir={isAr ? "rtl" : "ltr"}>
      <div className={`flex items-center gap-3 mb-1 ${isAr ? "flex-row-reverse" : ""}`}>
        <h1 className="text-2xl font-bold text-gray-900">{t}</h1>
        <span className="text-sm text-gray-400">{filtered.length}</span>
        <button onClick={() => load()} className={`text-xs text-blue-600 hover:underline ${isAr ? "mr-auto" : "ml-auto"}`}>{m.refresh}</button>
      </div>
      <p className="text-sm text-gray-500 mb-6">{sub}</p>

      <div className="mb-5">
        <input className={`${inputCls} w-full max-w-md`} placeholder={m.search} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState text={m.empty} />
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm" dir={isAr ? "rtl" : "ltr"}>
            <thead>
              <tr className="text-gray-500 border-b border-gray-100 text-xs uppercase tracking-wide">
                {cols.map((f) => (<th key={f} className="text-start font-medium px-4 py-3">{label(f)}</th>))}
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((rec) => (
                <tr key={rec.row} className="hover:bg-gray-50/60">
                  {cols.map((f, i) => (
                    <td key={f} className={`px-4 py-3 ${i === 0 ? "font-medium text-gray-900" : "text-gray-600"}`}>
                      {rec[f] || "—"}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-end">
                    <Btn variant="outline" onClick={() => openEdit(rec)}>{m.details}</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={!!editing}
        title={editing ? (cols.map((f) => editing[f]).filter(Boolean).join(" · ") || m.details) : m.details}
        onClose={() => setEditing(null)}
        isAr={isAr}
      >
        {editing && (
          <form onSubmit={handleSave}>
            {!data.writable && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 mb-4">
                <p className="text-sm font-medium text-amber-900">{m.writeDisabledTitle}</p>
                <p className="text-xs text-amber-800 leading-relaxed mt-0.5">{m.writeDisabledBody}</p>
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-x-4">
              {data.fields.filter((f) => !data.longFields.includes(f)).map((key) => (
                <Field key={key} label={label(key)}>
                  <input className={inputCls} value={form[key] ?? ""} disabled={!data.writable}
                    onChange={(e) => setForm((s) => ({ ...s, [key]: e.target.value }))} />
                </Field>
              ))}
            </div>
            {data.fields.filter((f) => data.longFields.includes(f)).map((key) => (
              <Field key={key} label={label(key)}>
                <textarea className={`${inputCls} resize-none`} rows={2} value={form[key] ?? ""} disabled={!data.writable}
                  onChange={(e) => setForm((s) => ({ ...s, [key]: e.target.value }))} />
              </Field>
            ))}
            {saveMsg && <p className="text-sm text-red-600 mb-2">{saveMsg}</p>}
            <div className={`flex gap-3 mt-2 ${isAr ? "flex-row-reverse" : ""}`}>
              <Btn type="submit" disabled={saving || !data.writable}>{saving ? m.saving : m.save}</Btn>
              <Btn type="button" variant="outline" onClick={() => setEditing(null)}>{m.cancel}</Btn>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
