"use client";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useLang } from "@/context/LangContext";
import { mr } from "@/lib/i18n.register";
import { pd } from "@/lib/i18n.prod";
import { Field, inputCls, Btn, Modal, Spinner, EmptyState, LoadError } from "@/components/dashboard/ui";
import { authedFetch } from "@/lib/authed-fetch";
import { timedJson } from "@/components/dashboard/last-seen";
import { useRemembered, useVisiblePoll } from "@/components/dashboard/use-remembered";

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
 *
 * ONE entity per page (products, clients), so the device snapshot is keyed by
 * the entity: `itqan.sheet.<entity>.last`. Speed (2026-09-10) — a sheet read
 * is seconds on a cold instance and this component had no timeout at all: the
 * spinner turned until the platform killed the function, and a transient
 * failure was swallowed silently, leaving the page looking merely slow. Now
 * the tab this device saw last renders AT ONCE, the live read is bounded, a
 * failure keeps the rows and says so with a retry, and an empty or failed
 * answer never replaces good rows. Saves still write and re-render LIVE.
 *
 * The read keeps `authedFetch` for every entity: the tab is chosen at runtime
 * and «العملاء» is a guarded read (contact data, server-side rule), so the
 * token must travel. Sending it to an open tab costs nothing.
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
  const p = pd[lang];
  const isAr = lang === "ar";

  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Rec | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  // authed: the clients tab (contact/payment data) is signed-in-only server-side.
  // Keying the snapshot by entity is what discards the previous tab's rows when
  // the section switches. An empty answer never replaces rows that are on
  // screen — "no records" read as the truth is the lie this guards against.
  const { data, setData, loading, failed, reload: load } = useRemembered<Payload>({
    key: `itqan.sheet.${entity}.last`,
    read: async () => {
      const r = await timedJson<Payload>(authedFetch, `/api/sheet/${entity}`);
      return r.ok && !Array.isArray(r.data?.records) ? { ok: false, status: 0, timedOut: false } : r;
    },
    valid: (snap) => Array.isArray(snap?.records),
    merge: (prev, next) => (prev && prev.records.length > 0 && next.records.length === 0 ? prev : next),
    worthRemembering: (next) => next.records.length > 0,
  });
  // Auto-refresh so sheet edits appear without a manual reload — paused while
  // editing AND while the tab is hidden (long-lived background tabs otherwise
  // keep fetching and become targets for the browser's memory-saver tab kill).
  // Coming back to the tab refreshes immediately.
  useVisiblePoll(() => { if (!editing) load(); }, 20000);
  useEffect(() => {
    const onVis = () => { if (!document.hidden && !editing) load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [editing, load]);

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
    const res = await authedFetch(`/api/sheet/${entity}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ row: editing.row, changes }),
    });
    const json = await res.json().catch(() => ({ ok: false }));
    setSaving(false);
    if (json.ok) {
      setData((d) => (d ? { ...d, records: d.records.map((r) => (r.row === editing.row ? { ...r, ...changes } : r)) } : d));
      setEditing(null);
      // The cell is shown optimistically, then re-read from the sheet — a
      // write is never confirmed against the device snapshot.
      load();
    } else {
      setSaveMsg(`${m.saveFailed}${json.reason ? ` · ${json.reason}` : ""}`);
    }
  }

  const t = isAr ? title.ar : title.en;
  const sub = isAr ? subtitle.ar : subtitle.en;

  // Nothing on screen and the read did not arrive: the error state plus the
  // one action that helps. With a snapshot showing, this branch is skipped and
  // the line inside the page says the rows are not live.
  if (failed && !data) {
    return (
      <div className="max-w-5xl" dir={isAr ? "rtl" : "ltr"}>
        <h1 className="text-2xl font-bold text-gray-900 mb-4">{t}</h1>
        <div className="bg-white border border-dashed border-red-300 rounded-xl p-10 text-center text-sm text-red-600">
          <p>{failed.timedOut ? p.common.timedOut : m.loadError}</p>
          <Btn variant="outline" onClick={load} disabled={loading} className="mt-4">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />{m.refresh}
          </Btn>
        </div>
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

  const cols = data.fields.slice(0, columns);
  const q = query.trim().toLowerCase();
  const filtered = data.records.filter((r) => !q || data.fields.some((f) => (r[f] || "").toLowerCase().includes(q)));

  return (
    <div className="max-w-5xl" dir={isAr ? "rtl" : "ltr"}>
      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-2xl font-bold text-gray-900">{t}</h1>
        <span className="text-sm text-gray-400 tabular-nums">{filtered.length}</span>
        <button
          onClick={() => load()}
          disabled={loading}
          className="ms-auto inline-flex items-center gap-1.5 min-h-11 sm:min-h-0 px-2 -mx-2 rounded text-xs text-blue-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:opacity-60"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          {m.refresh}
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-6">{sub}</p>

      {/* Rows are on screen and the live read did not arrive: keep them, say so. */}
      {failed && (
        <LoadError
          className="mb-5"
          text={failed.timedOut ? p.common.timedOut : m.loadError}
          retry={p.common.retry}
          onRetry={() => load()}
          loading={loading}
          icon={<RefreshCw size={13} className={loading ? "animate-spin" : ""} />}
        />
      )}
      {/* A remembered tab is showing while the live read is still in flight. */}
      {!failed && loading && <p className="text-xs text-gray-400 mb-5">{p.common.stillLoading}</p>}

      <div className="mb-5">
        <input className={`${inputCls} w-full max-w-md`} placeholder={m.search} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState text={m.empty} />
      ) : (
        <>
        {/* Phone: stacked cards (tap a card to open details) */}
        <div className="sm:hidden space-y-3">
          {filtered.map((rec) => (
            <button
              key={rec.row}
              onClick={() => openEdit(rec)}
              className="w-full text-start bg-white border border-gray-200 rounded-xl p-4 active:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            >
              <div className="flex items-center justify-between gap-3 min-w-0">
                <span className="font-medium text-gray-900 leading-snug min-w-0 truncate">{rec[cols[0]] || "—"}</span>
                {isAr ? (
                  <ChevronLeft size={14} className="text-gray-300 shrink-0" />
                ) : (
                  <ChevronRight size={14} className="text-gray-300 shrink-0" />
                )}
              </div>
              {cols.slice(1).some((f) => rec[f]) && (
                <div className="mt-2 space-y-1 text-sm">
                  {cols.slice(1).map((f) =>
                    rec[f] ? (
                      <div key={f} className="flex items-baseline justify-between gap-3">
                        <span className="text-gray-400 truncate max-w-[45%]">{label(f)}</span>
                        <span className="text-gray-600 min-w-0 text-end truncate">{rec[f]}</span>
                      </div>
                    ) : null
                  )}
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
                  {cols.map((f) => (
                    <th key={f} className="text-start px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{label(f)}</th>
                  ))}
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((rec) => (
                  <tr key={rec.row} className="hover:bg-gray-50/50 transition-colors">
                    {cols.map((f, i) => (
                      <td key={f} className={`px-4 py-3 ${i === 0 ? "font-medium text-gray-900" : "text-gray-700"}`}>
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
        </div>
        </>
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
            <div className="flex flex-wrap items-center gap-3 mt-2">
              <Btn type="submit" disabled={saving || !data.writable}>{saving ? m.saving : m.save}</Btn>
              <Btn type="button" variant="outline" onClick={() => setEditing(null)}>{m.cancel}</Btn>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
