"use client";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { Plus, Trash2, Building2 } from "lucide-react";

type Client = {
  id: string;
  name: string;
  industry: string;
  logo: string;
};

export default function ClientsPage() {
  const { lang } = useLang();
  const tr = t[lang];
  const isAr = lang === "ar";
  const [clients, setClients] = useState<Client[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [logo, setLogo] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const res = await fetch("/api/clients");
    if (res.ok) setClients(await res.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, industry, logo }),
    });
    setName("");
    setIndustry("");
    setLogo("");
    setShowForm(false);
    setSaving(false);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm(isAr ? "حذف هذا العميل؟" : "Delete this client?")) return;
    await fetch(`/api/clients/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="max-w-3xl">
      <div className={`flex items-center justify-between mb-8 ${isAr ? "flex-row-reverse" : ""}`}>
        <h1 className="text-2xl font-bold text-gray-900">{tr.dashboard.clients}</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded-lg font-medium transition-colors"
        >
          <Plus size={15} />
          {tr.dashboard.addClient}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleAdd}
          className="bg-white border border-gray-200 rounded-xl p-6 mb-6 space-y-4"
        >
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">{tr.dashboard.clientName}</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">{tr.dashboard.clientIndustry}</label>
              <input
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">{tr.dashboard.clientLogo}</label>
            <input
              value={logo}
              onChange={(e) => setLogo(e.target.value)}
              placeholder="/clients/your-logo.png"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
            />
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

      {clients.length === 0 ? (
        <p className="text-gray-400 text-sm">{tr.dashboard.noClients}</p>
      ) : (
        <div className="space-y-3">
          {clients.map((c) => (
            <div
              key={c.id}
              className="bg-white border border-gray-200 rounded-xl px-5 py-4 flex items-center justify-between"
            >
              <div className={`flex items-center gap-4 ${isAr ? "flex-row-reverse" : ""}`}>
                <div className="w-10 h-10 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center overflow-hidden shrink-0">
                  {c.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.logo} alt={c.name} className="w-full h-full object-contain p-1" />
                  ) : (
                    <Building2 size={16} className="text-gray-300" />
                  )}
                </div>
                <div dir={isAr ? "rtl" : "ltr"}>
                  <p className="font-medium text-gray-900">{c.name}</p>
                  {c.industry && <p className="text-xs text-gray-400 mt-0.5">{c.industry}</p>}
                </div>
              </div>
              <button
                onClick={() => handleDelete(c.id)}
                title={isAr ? "حذف" : "Delete"}
                className="text-gray-300 hover:text-red-500 transition-colors"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
