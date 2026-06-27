"use client";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import { useEffect, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";

type Machine = { id: string; name: string; type: string; status: string };
type Note = { id: string; note: string; note_date: string };

export default function MachinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { lang } = useLang();
  const tr = t[lang];
  const isAr = lang === "ar";
  const [machine, setMachine] = useState<Machine | null>(null);
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
    await fetch(`/api/machines/${id}/notes`, {
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
    await fetch(`/api/machines/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: s }),
    });
    loadMachine();
  }

  async function handleDelete() {
    if (!confirm(isAr ? "حذف هذه الماكينة وكل ملاحظاتها؟" : "Delete this machine and all its notes?")) return;
    await fetch(`/api/machines/${id}`, { method: "DELETE" });
    router.push("/dashboard/machines");
  }

  if (!machine) return <div className="text-gray-400 text-sm">Loading...</div>;

  return (
    <div className="max-w-2xl">
      <Link
        href="/dashboard/machines"
        className="text-sm text-blue-600 hover:underline mb-6 inline-block"
      >
        {tr.dashboard.backToMachines}
      </Link>

      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
        <div className={`flex items-start justify-between gap-3 mb-4 ${isAr ? "flex-row-reverse" : ""}`}>
          <h1 className="text-xl font-bold text-gray-900">{machine.name}</h1>
          <button
            onClick={handleDelete}
            title={isAr ? "حذف" : "Delete"}
            className="flex items-center gap-1.5 text-xs text-red-500 hover:text-white hover:bg-red-500 border border-red-200 hover:border-red-500 px-2.5 py-1.5 rounded-lg transition-colors"
          >
            <Trash2 size={13} />
            {isAr ? "حذف" : "Delete"}
          </button>
        </div>
        <div className="grid sm:grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">{tr.dashboard.machineType}: </span>
            <span className="font-medium">{machine.type}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-500">{tr.dashboard.machineStatus}: </span>
            <select
              value={newStatus}
              onChange={(e) => handleStatusChange(e.target.value)}
              className="border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-400"
            >
              {tr.dashboard.machineStatuses.map((ms) => (
                <option key={ms}>{ms}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className={`flex items-center justify-between mb-4 ${isAr ? "flex-row-reverse" : ""}`}>
        <h2 className="font-semibold text-gray-900">Notes</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg font-medium transition-colors"
        >
          <Plus size={13} />
          {tr.dashboard.addNote}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleAddNote} className="bg-white border border-gray-200 rounded-xl p-5 mb-4 space-y-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1">{tr.dashboard.noteDate}</label>
            <input
              type="date"
              value={noteDate}
              onChange={(e) => setNoteDate(e.target.value)}
              required
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">{tr.dashboard.noteText}</label>
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              required
              rows={3}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 resize-none"
            />
          </div>
          <div className={`flex gap-3 ${isAr ? "flex-row-reverse" : ""}`}>
            <button
              type="submit"
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm px-4 py-2 rounded-lg font-medium transition-colors"
            >
              {tr.dashboard.save}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-sm px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50"
            >
              {tr.dashboard.cancel}
            </button>
          </div>
        </form>
      )}

      {notes.length === 0 ? (
        <p className="text-sm text-gray-400">{tr.dashboard.noNotes}</p>
      ) : (
        <div className="space-y-3">
          {notes.map((n) => (
            <div key={n.id} className="bg-white border border-gray-100 rounded-xl px-5 py-4">
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
