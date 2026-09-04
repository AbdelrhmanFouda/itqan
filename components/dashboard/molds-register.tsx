"use client";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLang } from "@/context/LangContext";
import { mr } from "@/lib/i18n.register";
import { normalizeArabic } from "@/lib/prod-meta";
import { moldKey } from "@/lib/mold-number";
import { Field, inputCls, Btn, Modal, Spinner, EmptyState } from "@/components/dashboard/ui";
import { authedFetch } from "@/lib/authed-fetch";
import type { MoldRow } from "@/app/api/molds/route";

/**
 * The mould register — /dashboard/molds.
 *
 * Reads Master through GET /api/molds and shows, for every product, THE MOULD
 * NUMBER first: column D «كود الاسطمبة», or — when the sheet keeps it there —
 * the customer's number from the notes, marked as such. Phone-first: the
 * worker at the press opens this to read the number of the mould in front of
 * them, so the number is the biggest thing on the card and the search box
 * takes a number, a product name or a client.
 *
 * Editing is open to every signed-in role (owner's word, 2026-09-04; `canEdit`
 * still comes from the API, never from the client) and goes through
 * PATCH /api/molds, which re-locates the row by NAME on a fresh read. When the
 * bridge cannot write, the same modal opens read-only.
 */

type Payload = { molds: MoldRow[]; writable: boolean; canEdit: boolean; configured: boolean };
type NumberFilter = "all" | "with" | "without";

// Search folding: Arabic spelling variants + Arabic-Indic digits + case, so
// «اسطمبه» finds «إسطمبة» and «٥٠» finds «50».
const fold = (v: string) => normalizeArabic(moldKey(v));

const EDIT_FIELDS: (keyof MoldRow)[] = [
  "code", "client", "category", "cavities", "cycle", "worstCycle",
  "weight", "material", "machine", "defects", "active", "notes",
];
const LONG_FIELDS = new Set<keyof MoldRow>(["defects", "notes"]);

export default function MoldsRegister({ title, subtitle }: {
  title: { en: string; ar: string };
  subtitle: { en: string; ar: string };
}) {
  const { lang } = useLang();
  const m = mr[lang];
  const isAr = lang === "ar";

  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [numberFilter, setNumberFilter] = useState<NumberFilter>("all");
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<MoldRow | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  async function load(initial = false) {
    try {
      const res = await authedFetch("/api/molds");
      // A non-2xx (an expired token) must show as an error, never as an empty
      // register — the owner would read "no moulds" as the truth.
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as Payload;
      setError(false);
      setData((prev) => (!initial && prev && prev.molds.length > 0 && json.molds.length === 0 ? prev : json));
    } catch {
      if (initial) setError(true);
    }
  }
  useEffect(() => { load(true); }, []);
  // Refresh while the tab is visible and nothing is open — a Master edit made
  // in the sheet appears without a reload.
  useEffect(() => {
    const id = setInterval(() => { if (!selected && !document.hidden) load(); }, 30000);
    const onVis = () => { if (!document.hidden && !selected) load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [selected]);

  const label = (f: keyof MoldRow): string => {
    switch (f) {
      case "code": return m.code;
      case "client": return m.client;
      case "category": return m.category;
      case "cavities": return m.cavities;
      case "cycle": return m.cycle;
      case "worstCycle": return isAr ? "أسوأ زمن الدورة (ث)" : "Worst cycle (s)";
      case "weight": return m.weight;
      case "material": return m.material;
      case "machine": return m.machine;
      case "defects": return m.defects;
      case "active": return m.active;
      case "notes": return m.notes;
      case "name": return m.name;
      default: return String(f);
    }
  };

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const r of data?.molds ?? []) if (r.category) set.add(r.category);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ar"));
  }, [data]);

  const filtered = useMemo(() => {
    const terms = fold(query).split(" ").filter(Boolean);
    return (data?.molds ?? []).filter((r) => {
      if (numberFilter === "with" && !r.number) return false;
      if (numberFilter === "without" && r.number) return false;
      if (category && r.category !== category) return false;
      if (terms.length === 0) return true;
      const hay = fold([r.number, r.code, r.notesNumber, r.name, r.client, r.category, r.machine, r.material].join(" "));
      return terms.every((t) => hay.includes(t));
    });
  }, [data, query, numberFilter, category]);

  function openRow(rec: MoldRow) {
    const f: Record<string, string> = {};
    for (const k of EDIT_FIELDS) f[k] = String(rec[k] ?? "");
    setForm(f); setSaveMsg(""); setSelected(rec);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !data?.canEdit || !data.writable) return;
    // Only the cells the user changed travel — never clobber the rest.
    const changes: Record<string, string> = {};
    for (const k of EDIT_FIELDS) {
      const next = form[k] ?? "";
      if (next !== String(selected[k] ?? "")) changes[k] = next;
    }
    if (Object.keys(changes).length === 0) { setSelected(null); return; }
    setSaving(true); setSaveMsg("");
    const res = await authedFetch("/api/molds", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ row: selected.row, name: selected.name, changes }),
    }).catch(() => null);
    const json = res ? await res.json().catch(() => ({ ok: false })) : { ok: false };
    setSaving(false);
    if (json.ok) {
      setSelected(null);
      load();
    } else {
      setSaveMsg(json.reason === "identity_mismatch" ? m.identityMismatch : `${m.saveFailed}${json.reason ? ` · ${json.reason}` : ""}`);
    }
  }

  const t = isAr ? title.ar : title.en;
  const sub = isAr ? subtitle.ar : subtitle.en;

  if (error) {
    return (
      <div className="max-w-5xl" dir={isAr ? "rtl" : "ltr"}>
        <h1 className="text-2xl font-bold text-gray-900 mb-4">{t}</h1>
        <div className="bg-white border border-dashed border-red-300 rounded-xl p-10 text-center text-sm text-red-600">{m.loadError}</div>
      </div>
    );
  }
  if (data === null) return <div className="flex justify-center py-16"><Spinner text={m.loading} /></div>;

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

  const canEdit = data.canEdit && data.writable;
  const withNumber = data.molds.filter((r) => r.number).length;

  return (
    <div className="max-w-5xl" dir={isAr ? "rtl" : "ltr"}>
      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-2xl font-bold text-gray-900">{t}</h1>
        <span className="text-sm text-gray-400 tabular-nums">{filtered.length}</span>
        <button
          onClick={() => load()}
          className="ms-auto inline-flex items-center min-h-11 sm:min-h-0 px-2 -mx-2 rounded text-xs text-blue-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
        >
          {m.refresh}
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-4">{sub}</p>
      {!canEdit && <p className="text-xs text-gray-400 mb-4">{m.readOnlyHint}</p>}

      <div className="mb-4">
        <input
          className={`${inputCls} w-full max-w-md`}
          placeholder={m.searchNumber}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          inputMode="search"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-5">
        {([
          ["all", `${m.filterAll} · ${data.molds.length}`],
          ["with", `${m.withNumber} · ${withNumber}`],
          ["without", `${m.withoutNumber} · ${data.molds.length - withNumber}`],
        ] as [NumberFilter, string][]).map(([key, text]) => (
          <button
            key={key}
            onClick={() => setNumberFilter(key)}
            aria-pressed={numberFilter === key}
            className={`inline-flex items-center min-h-11 sm:min-h-9 px-3 rounded-full border text-xs font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
              numberFilter === key ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {text}
          </button>
        ))}
        {categories.length > 0 && (
          <select
            className={`${inputCls} w-auto min-h-11 sm:min-h-9 py-1.5 text-xs`}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label={m.category}
          >
            <option value="">{m.allCategories}</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState text={m.empty} />
      ) : (
        <>
          {/* Phone: one card per mould, the number first */}
          <div className="sm:hidden space-y-3">
            {filtered.map((rec) => (
              <button
                key={rec.row}
                onClick={() => openRow(rec)}
                className="w-full text-start bg-white border border-gray-200 rounded-xl p-4 active:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
              >
                <div className="flex items-center justify-between gap-3 min-w-0">
                  <NumberCell rec={rec} m={m} big />
                  {isAr ? <ChevronLeft size={14} className="text-gray-300 shrink-0" /> : <ChevronRight size={14} className="text-gray-300 shrink-0" />}
                </div>
                <div className="mt-1.5 font-medium text-gray-900 leading-snug">
                  {rec.name || "—"}
                  {rec.ambiguous && <span className="ms-2 text-[11px] font-normal text-amber-700">· {m.duplicateName}</span>}
                </div>
                <div className="text-xs text-gray-500 mt-0.5 truncate">
                  {[rec.client, rec.category].filter(Boolean).join(" · ") || "—"}
                </div>
                {(rec.cavities || rec.cycle || rec.machine) && (
                  <div className="text-xs text-gray-400 mt-1 truncate">
                    {[
                      rec.cavities ? `${m.cavities}: ${rec.cavities}` : "",
                      rec.cycle ? `${m.cycle}: ${rec.cycle}` : "",
                      rec.machine,
                    ].filter(Boolean).join(" · ")}
                  </div>
                )}
              </button>
            ))}
          </div>
          {/* Tablet/desktop: the table */}
          <div className="hidden sm:block bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/50">
                    {[m.number, m.name, m.client, m.category, m.cavities, m.cycle, m.machine, m.notes].map((h) => (
                      <th key={h} className="text-start px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{h}</th>
                    ))}
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((rec) => (
                    <tr key={rec.row} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap"><NumberCell rec={rec} m={m} /></td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {rec.name || "—"}
                        {rec.ambiguous && <span className="ms-2 text-[11px] font-normal text-amber-700">· {m.duplicateName}</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{rec.client || "—"}</td>
                      <td className="px-4 py-3 text-gray-500">{rec.category || "—"}</td>
                      <td className="px-4 py-3 text-gray-700 tabular-nums">{rec.cavities || "—"}</td>
                      <td className="px-4 py-3 text-gray-700 tabular-nums">{rec.cycle || "—"}</td>
                      <td className="px-4 py-3 text-gray-500">{rec.machine || "—"}</td>
                      <td className="px-4 py-3 text-gray-500 max-w-[16rem] truncate" title={rec.notes}>{rec.notes || "—"}</td>
                      <td className="px-4 py-3 text-end">
                        <Btn variant="outline" onClick={() => openRow(rec)}>{canEdit ? m.details : (isAr ? "عرض" : "View")}</Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <Modal
        open={!!selected}
        title={selected ? [selected.number ? `${m.number} ${selected.number}` : m.noNumber, selected.name].filter(Boolean).join(" · ") : ""}
        onClose={() => setSelected(null)}
        isAr={isAr}
      >
        {selected && (canEdit ? (
          <form onSubmit={handleSave}>
            <Field label={m.name}>
              <input className={inputCls} value={selected.name} disabled readOnly />
            </Field>
            {selected.notesNumber && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
                {m.notesNumber}: <span dir="ltr" className="font-mono">{selected.notesNumber}</span>
              </p>
            )}
            <div className="grid sm:grid-cols-2 gap-x-4">
              {EDIT_FIELDS.filter((k) => !LONG_FIELDS.has(k)).map((k) => (
                <Field key={k} label={label(k)}>
                  <input className={inputCls} value={form[k] ?? ""} onChange={(e) => setForm((s) => ({ ...s, [k]: e.target.value }))} />
                </Field>
              ))}
            </div>
            {EDIT_FIELDS.filter((k) => LONG_FIELDS.has(k)).map((k) => (
              <Field key={k} label={label(k)}>
                <textarea className={`${inputCls} resize-none`} rows={2} value={form[k] ?? ""} onChange={(e) => setForm((s) => ({ ...s, [k]: e.target.value }))} />
              </Field>
            ))}
            {saveMsg && <p className="text-sm text-red-600 mb-2">{saveMsg}</p>}
            <div className="flex flex-wrap items-center gap-3 mt-2">
              <Btn type="submit" disabled={saving}>{saving ? m.saving : m.save}</Btn>
              <Btn type="button" variant="outline" onClick={() => setSelected(null)}>{m.cancel}</Btn>
            </div>
          </form>
        ) : (
          <div className="space-y-3 text-sm">
            <DetailRow label={m.number}>
              <NumberCell rec={selected} m={m} big />
            </DetailRow>
            {selected.notesNumber && (
              <DetailRow label={m.notesNumber}><span dir="ltr" className="font-mono">{selected.notesNumber}</span></DetailRow>
            )}
            <DetailRow label={m.name}>{selected.name || "—"}</DetailRow>
            {(["client", "category", "cavities", "cycle", "worstCycle", "weight", "material", "machine", "defects", "active", "notes"] as (keyof MoldRow)[]).map((k) => (
              <DetailRow key={k} label={label(k)}>{String(selected[k] || "—")}</DetailRow>
            ))}
            <div className="pt-2">
              <Btn type="button" variant="outline" onClick={() => setSelected(null)}>{m.cancel}</Btn>
            </div>
          </div>
        ))}
      </Modal>
    </div>
  );
}

/**
 * The number, the way the sheet holds it: the code in D (mono, LTR), and
 * beside it the customer's number from the notes when there is one; a number
 * that came ONLY from the notes is marked so nobody mistakes it for a
 * registry code. No number at all reads as such — never as a dash that could
 * mean "not loaded".
 */
function NumberCell({ rec, m, big }: { rec: MoldRow; m: (typeof mr)["ar"]; big?: boolean }) {
  if (!rec.number) return <span className={`text-gray-400 ${big ? "text-base" : "text-xs"}`}>{m.noNumber}</span>;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
      <span dir="ltr" className={`font-mono font-semibold text-gray-900 tabular-nums ${big ? "text-xl" : ""}`}>{rec.number}</span>
      {rec.numberSource === "notes" ? (
        <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 whitespace-nowrap">{m.numberFromNotes}</span>
      ) : rec.notesNumber ? (
        <span dir="ltr" className="font-mono text-xs text-gray-500">· {rec.notesNumber}</span>
      ) : null}
    </span>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <div className="text-gray-900 whitespace-pre-wrap">{children}</div>
    </div>
  );
}
