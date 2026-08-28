"use client";
import { usePageTitle } from "@/components/dashboard/use-page-title";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import { useEffect, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { authedFetch } from "@/lib/authed-fetch";
import { Btn, EmptyState, Field, Spinner, inputCls } from "@/components/dashboard/ui";

type Machine = { id: string; name: string; type: string; status: string };
type Note = { id: string; note: string; note_date: string };

export default function MachinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { lang } = useLang();
  const tr = t[lang];
  const isAr = lang === "ar";
  const [machine, setMachine] = useState<Machine | null>(null);
  usePageTitle(machine ? machine.name : tr.dashboard.machines);
  const [notes, setNotes] = useState<Note[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteDate, setNoteDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [newStatus, setNewStatus] = useState("");

  async function loadMachine() {
    const res = await fetch(`/api/machines/${id}`);
    if (res.ok) {
      const m = await res.json();
      setMachine(m);
      setNewStatus(m.status);
    }
  }

  async function loadNotes() {
    const res = await fetch(`/api/machines/${id}/notes`);
    if (res.ok) setNotes(await res.json());
  }

  useEffect(() => {
    loadMachine();
    loadNotes();
  }, [id]);

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
    if (!confirm(isAr ? "حذف هذه الماكينة وكل ملاحظاتها؟" : "Delete this machine and all its notes?")) return;
    await authedFetch(`/api/machines/${id}`, { method: "DELETE" });
    router.push("/dashboard/machines");
  }

  if (!machine) {
    return (
      <div className="flex justify-center py-16">
        <Spinner text={isAr ? "جارٍ التحميل…" : "Loading…"} />
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

      <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5 mb-6">
        <div className="flex items-start justify-between gap-3 mb-4">
          <h1 className="text-2xl font-bold text-gray-900 min-w-0 break-words">{machine.name}</h1>
          <button
            onClick={handleDelete}
            title={isAr ? "حذف" : "Delete"}
            className="shrink-0 inline-flex items-center justify-center gap-1.5 min-h-11 sm:min-h-0 text-xs text-red-600 hover:text-white hover:bg-red-500 border border-red-200 hover:border-red-500 px-2.5 py-1.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 focus-visible:ring-offset-1"
          >
            <Trash2 size={13} />
            {isAr ? "حذف" : "Delete"}
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
                {new Date(n.note_date).toLocaleDateString(isAr ? "ar-EG" : "en-GB", {
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
