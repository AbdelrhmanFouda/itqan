"use client";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, FileText, Trash2 } from "lucide-react";

type Report = { id: string; month: number; year: number; jobs_completed: number | null; notes: string };

const monthNames = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const monthNamesAr = [
  "يناير","فبراير","مارس","أبريل","مايو","يونيو",
  "يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر",
];

export default function ReportsPage() {
  const { lang } = useLang();
  const tr = t[lang];
  const isAr = lang === "ar";
  const [reports, setReports] = useState<Report[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const now = new Date();
  const [form, setForm] = useState({
    month: String(now.getMonth() + 1),
    year: String(now.getFullYear()),
    jobs_completed: "",
    notes: "",
    issues: "",
    recommendations: "",
  });

  async function load() {
    const res = await fetch("/api/reports");
    if (res.ok) setReports(await res.json());
  }

  useEffect(() => { load(); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setShowForm(false);
    setSaving(false);
    load();
  }

  async function handleDelete(rid: string) {
    if (!confirm(isAr ? "حذف هذا التقرير؟" : "Delete this report?")) return;
    await fetch(`/api/reports/${rid}`, { method: "DELETE" });
    load();
  }

  const months = isAr ? monthNamesAr : monthNames;

  return (
    <div className="max-w-3xl">
      <div className={`flex items-center justify-between mb-8 ${isAr ? "flex-row-reverse" : ""}`}>
        <h1 className="text-2xl font-bold text-gray-900">{tr.dashboard.reports}</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded-lg font-medium transition-colors"
        >
          <Plus size={15} />
          {tr.dashboard.newReport}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="bg-white border border-gray-200 rounded-xl p-6 mb-6 space-y-4"
        >
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">{tr.dashboard.reportMonth}</label>
              <select
                value={form.month}
                onChange={(e) => setForm({ ...form, month: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
              >
                {months.map((m, i) => (
                  <option key={m} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">{tr.dashboard.reportYear}</label>
              <input
                type="number"
                value={form.year}
                onChange={(e) => setForm({ ...form, year: e.target.value })}
                min="2020"
                max="2100"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">{tr.dashboard.reportJobs}</label>
            <input
              type="number"
              value={form.jobs_completed}
              onChange={(e) => setForm({ ...form, jobs_completed: e.target.value })}
              min="0"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">{tr.dashboard.reportNotes}</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 resize-none"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">{tr.dashboard.reportIssues}</label>
            <textarea
              value={form.issues}
              onChange={(e) => setForm({ ...form, issues: e.target.value })}
              rows={2}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 resize-none"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">{tr.dashboard.reportRecommendations}</label>
            <textarea
              value={form.recommendations}
              onChange={(e) => setForm({ ...form, recommendations: e.target.value })}
              rows={2}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 resize-none"
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
              className="text-sm px-5 py-2 rounded-lg border border-gray-200 hover:bg-gray-50"
            >
              {tr.dashboard.cancel}
            </button>
          </div>
        </form>
      )}

      {reports.length === 0 ? (
        <p className="text-sm text-gray-400">{tr.dashboard.noReports}</p>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <div
              key={r.id}
              className="bg-white border border-gray-100 hover:border-blue-300 rounded-xl px-5 py-4 flex items-center justify-between group transition-colors"
            >
              <Link
                href={`/dashboard/reports/${r.id}`}
                className={`flex items-center gap-3 flex-1 ${isAr ? "flex-row-reverse" : ""}`}
              >
                <FileText size={16} className="text-gray-300" />
                <div dir={isAr ? "rtl" : "ltr"}>
                  <p className="font-medium text-gray-900">
                    {months[r.month - 1]} {r.year}
                  </p>
                  {r.jobs_completed != null && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      {r.jobs_completed} {tr.dashboard.reportJobs.toLowerCase()}
                    </p>
                  )}
                </div>
              </Link>
              <div className={`flex items-center gap-4 ${isAr ? "flex-row-reverse" : ""}`}>
                <Link href={`/dashboard/reports/${r.id}`} className="text-xs text-blue-600 hover:underline">
                  {tr.dashboard.viewReport}
                </Link>
                <button
                  onClick={() => handleDelete(r.id)}
                  title={isAr ? "حذف" : "Delete"}
                  className="text-gray-300 hover:text-red-500 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
