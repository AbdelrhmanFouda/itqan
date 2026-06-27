"use client";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, ChevronRight, Circle } from "lucide-react";

type Machine = {
  id: string;
  name: string;
  type: string;
  status: string;
  last_note_date: string | null;
};

const statusColor: Record<string, string> = {
  Operational: "text-green-500",
  "Under Maintenance": "text-yellow-500",
  Idle: "text-gray-400",
  "Out of Service": "text-red-500",
  "تعمل": "text-green-500",
  "تحت الصيانة": "text-yellow-500",
  "خاملة": "text-gray-400",
  "خارج الخدمة": "text-red-500",
};

export default function MachinesPage() {
  const { lang } = useLang();
  const tr = t[lang];
  const isAr = lang === "ar";
  const [machines, setMachines] = useState<Machine[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState(tr.dashboard.machineTypes[0]);
  const [status, setStatus] = useState(tr.dashboard.machineStatuses[0]);
  const [saving, setSaving] = useState(false);

  async function load() {
    const res = await fetch("/api/machines");
    if (res.ok) setMachines(await res.json());
  }

  useEffect(() => { load(); }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch("/api/machines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, type, status }),
    });
    setName("");
    setShowForm(false);
    setSaving(false);
    load();
  }

  return (
    <div className="max-w-3xl">
      <div className={`flex items-center justify-between mb-8 ${isAr ? "flex-row-reverse" : ""}`}>
        <h1 className="text-2xl font-bold text-gray-900">{tr.dashboard.machines}</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded-lg font-medium transition-colors"
        >
          <Plus size={15} />
          {tr.dashboard.addMachine}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleAdd}
          className="bg-white border border-gray-200 rounded-xl p-6 mb-6 space-y-4"
        >
          <div>
            <label className="block text-sm text-gray-600 mb-1">{tr.dashboard.machineName}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">{tr.dashboard.machineType}</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
              >
                {tr.dashboard.machineTypes.map((mt) => (
                  <option key={mt}>{mt}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">{tr.dashboard.machineStatus}</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
              >
                {tr.dashboard.machineStatuses.map((ms) => (
                  <option key={ms}>{ms}</option>
                ))}
              </select>
            </div>
          </div>
          <div className={`flex gap-3 ${isAr ? "flex-row-reverse" : ""}`}>
            <button
              type="submit"
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm px-5 py-2 rounded-lg font-medium transition-colors"
            >
              {tr.dashboard.save}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-sm px-5 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
            >
              {tr.dashboard.cancel}
            </button>
          </div>
        </form>
      )}

      {machines.length === 0 ? (
        <p className="text-gray-400 text-sm">{tr.dashboard.noMachines}</p>
      ) : (
        <div className="space-y-3">
          {machines.map((m) => (
            <Link
              key={m.id}
              href={`/dashboard/machines/${m.id}`}
              className="bg-white border border-gray-200 hover:border-blue-300 rounded-xl px-5 py-4 flex items-center justify-between group transition-colors"
            >
              <div className={`flex items-center gap-4 ${isAr ? "flex-row-reverse" : ""}`}>
                <Circle
                  size={8}
                  className={`fill-current ${statusColor[m.status] ?? "text-gray-400"}`}
                />
                <div dir={isAr ? "rtl" : "ltr"}>
                  <p className="font-medium text-gray-900">{m.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {m.type} ·{" "}
                    {m.last_note_date
                      ? `${tr.dashboard.lastNote}: ${new Date(m.last_note_date).toLocaleDateString()}`
                      : tr.dashboard.noNotes}
                  </p>
                </div>
              </div>
              <div className={`flex items-center gap-3 ${isAr ? "flex-row-reverse" : ""}`}>
                <span className="text-xs text-gray-400">{m.status}</span>
                <ChevronRight
                  size={14}
                  className={`text-gray-300 group-hover:text-blue-500 transition-colors ${isAr ? "rotate-180" : ""}`}
                />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
