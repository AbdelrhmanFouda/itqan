"use client";
import { usePageTitle } from "@/components/dashboard/use-page-title";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import { useCallback, useEffect, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { authedFetch } from "@/lib/authed-fetch";
import { pd } from "@/lib/i18n.prod";
import { Btn, EmptyState, Field, Spinner, inputCls, LoadError } from "@/components/dashboard/ui";
import { timedJson } from "@/components/dashboard/last-seen";
import { LOCALE_AR } from "@/lib/format";

/**
 * One machine's card and its notes. This detail is FIRESTORE-era (lib/db),
 * not a sheet read, so there is no device snapshot to render — but it had no
 * timeout and no failure state either: a machine that does not exist, or a
 * read that stalled, left the spinner turning for ever. Both reads are
 * bounded now and a failure says which it was, with a retry.
 */

type Machine = { id: string; name: string; type: string; status: string };
type Note = { id: string; note: string; note_date: string };

/** Local bilingual strings, the same shape the machines list page uses. */
const L = {
  en: { notFound: "This machine no longer exists.", loading: "Loading…", delete: "Delete", confirmDelete: "Delete this machine and all its notes?" },
  ar: { notFound: "هذه الماكينة لم تعد موجودة.", loading: "جارٍ التحميل…", delete: "حذف", confirmDelete: "حذف هذه الماكينة وكل ملاحظاتها؟" },
};

export default function MachinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { lang } = useLang();
  const tr = t[lang];
  const p = pd[lang];
  const l = L[lang];
  const isAr = lang === "ar";
  const [machine, setMachine] = useState<Machine | null>(null);
  usePageTitle(machine ? machine.name : tr.dashboard.machines);
  const [notes, setNotes] = useState<Note[]>([]);
  /** "notFound" is the 404 — a different sentence from a read that failed. */
  const [state, setState] = useState<"loading" | "ok" | "notFound" | "failed" | "timedOut">("loading");
  const [showForm, setShowForm] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteDate, setNoteDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [newStatus, setNewStatus] = useState("");

  // Both GETs are open reads; both are bounded, so neither can spin for ever.
  const loadMachine = useCallback(async () => {
    setState((s) => (s === "ok" ? s : "loading"));
    const r = await timedJson<Machine>(fetch, `/api/machines/${id}`);
    if (r.ok && r.data) {
      setMachine(r.data);
      setNewStatus(r.data.status);
      setState("ok");
      return;
    }
    // A machine that is gone is not the same thing as a read that failed —
    // and neither is a spinner. Keep the card if one is already showing.
    if (r.ok) setState("notFound");
    else setState(r.status === 404 ? "notFound" : r.timedOut ? "timedOut" : "failed");
  }, [id]);

  const loadNotes = useCallback(async () => {
    const r = await timedJson<Note[]>(fetch, `/api/machines/${id}/notes`);
    // A failed notes read leaves the notes that are on screen alone.
    if (r.ok && Array.isArray(r.data)) setNotes(r.data);
  }, [id]);

  useEffect(() => {
    loadMachine();
    loadNotes();
  }, [loadMachine, loadNotes]);

  async function handleAddNote(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await authedFetch(`/api/machines/${id}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: noteText, note_date: noteDate }),
    });
    setNoteText("");
    setShowForm(false);
    setSaving(false);
    loadNotes();
  }

  async function handleStatusChange(s: string) {
    setNewStatus(s);
    await authedFetch(`/api/machines/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: s }),
    });
    loadMachine();
  }

  async function handleDelete() {
    if (!confirm(l.confirmDelete)) return;
    await authedFetch(`/api/machines/${id}`, { method: "DELETE" });
    router.push("/dashboard/machines");
  }

  if (!machine) {
    if (state === "loading") {
      return (
        <div className="flex justify-center py-16">
          <Spinner text={l.loading} />
        </div>
      );
    }
    // Not a spinner and not a blank page: say which of the three it is, and
    // offer the one action that can help.
    return (
      <div dir={isAr ? "rtl" : "ltr"} className="max-w-2xl">
        <Link
          href="/dashboard/machines"
          className="inline-flex items-center min-h-11 sm:min-h-0 text-sm text-blue-600 hover:underline mb-4 sm:mb-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1 rounded"
        >
          {tr.dashboard.backToMachines}
        </Link>
        <div className="bg-white border border-dashed border-red-300 rounded-xl p-10 text-center text-sm text-red-600">
          <p>{state === "notFound" ? l.notFound : state === "timedOut" ? p.common.timedOut : p.common.loadError}</p>
          {state !== "notFound" && (
            <Btn variant="outline" onClick={loadMachine} className="mt-4">
              <RefreshCw size={14} />{p.common.retry}
            </Btn>
          )}
        </div>
      </div>
    );
  }

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="max-w-2xl">
      <Link
        href="/dashboard/machines"
        className="inline-flex items-center min-h-11 sm:min-h-0 text-sm text-blue-600 hover:underline mb-4 sm:mb-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1 rounded"
      >
        {tr.dashboard.backToMachines}
      </Link>

      {/* The card is showing and a refresh did not arrive — keep the card, say so. */}
      {(state === "failed" || state === "timedOut") && (
        <LoadError
          className="mb-4"
          text={state === "timedOut" ? p.common.timedOut : p.common.loadError}
          retry={p.common.retry}
          onRetry={loadMachine}
          icon={<RefreshCw size={13} />}
        />
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5 mb-6">
        <div className="flex items-start justify-between gap-3 mb-4">
          <h1 className="text-2xl font-bold text-gray-900 min-w-0 break-words">{machine.name}</h1>
          <button
            onClick={handleDelete}
            title={l.delete}
            className="shrink-0 inline-flex items-center justify-center gap-1.5 min-h-11 sm:min-h-0 text-xs text-red-600 hover:text-white hover:bg-red-500 border border-red-200 hover:border-red-500 px-2.5 py-1.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 focus-visible:ring-offset-1"
          >
            <Trash2 size={13} />
            {l.delete}
          </button>
        </div>
        <div className="grid sm:grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">{tr.dashboard.machineType}: </span>
            <span className="font-medium text-gray-900">{machine.type}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-500 shrink-0">{tr.dashboard.machineStatus}: </span>
            <select
              value={newStatus}
              onChange={(e) => handleStatusChange(e.target.value)}
              className={inputCls}
            >
              {tr.dashboard.machineStatuses.map((ms) => (
                <option key={ms}>{ms}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-sm font-semibold text-gray-900">{tr.dashboard.notesHeading}</h2>
        <Btn onClick={() => setShowForm(!showForm)}>
          <Plus size={13} />
          {tr.dashboard.addNote}
        </Btn>
      </div>

      {showForm && (
        <form onSubmit={handleAddNote} className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5 mb-4">
          <Field label={tr.dashboard.noteDate}>
            <input
              type="date"
              value={noteDate}
              onChange={(e) => setNoteDate(e.target.value)}
              required
              className={inputCls}
            />
          </Field>
          <Field label={tr.dashboard.noteText}>
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              required
              rows={3}
              className={`${inputCls} resize-y leading-relaxed`}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Btn type="submit" disabled={saving}>{tr.dashboard.save}</Btn>
            <Btn variant="outline" onClick={() => setShowForm(false)}>{tr.dashboard.cancel}</Btn>
          </div>
        </form>
      )}

      {notes.length === 0 ? (
        <EmptyState text={tr.dashboard.noNotes} />
      ) : (
        <div className="space-y-3">
          {notes.map((n) => (
            <div key={n.id} className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5">
              <p className="text-xs text-gray-400 mb-1">
                {new Date(n.note_date).toLocaleDateString(isAr ? LOCALE_AR : "en-GB", {
                  year: "numeric", month: "long", day: "numeric",
                })}
              </p>
              <p className="text-sm text-gray-800 leading-relaxed">{n.note}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
