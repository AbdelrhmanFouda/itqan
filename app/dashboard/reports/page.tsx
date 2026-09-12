"use client";
import { usePageTitle } from "@/components/dashboard/use-page-title";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import { pd } from "@/lib/i18n.prod";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus, FileText, Trash2, Sparkles } from "lucide-react";
import { authedFetch } from "@/lib/authed-fetch";
import { readLastSeen, writeLastSeen, timedJson } from "@/components/dashboard/last-seen";
import { EmptyState, inputCls, Spinner } from "@/components/dashboard/ui";
import { LOCALE_AR } from "@/lib/format";

type Report = { id: string; month: number; year: number; jobs_completed: number | null; notes: string };
/** What this device saw last time — painted at once so the first open is not a spinner. */
const LAST_KEY = "itqan.reports.last";
type DraftMeta = {
  provider: "gemini" | "anthropic" | "rules";
  runCount: number;
  availabilityMeasured: boolean;
  qualityMeasured: boolean;
  staleOpen: number;
};

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
  const p = pd[lang];
  const isAr = lang === "ar";
  usePageTitle(tr.dashboard.reports);
  // null = nothing to show yet. A failed refresh must never turn a filled list
  // into an empty one — the list only ever moves forward on a good answer.
  const [reports, setReports] = useState<Report[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<null | { timedOut: boolean }>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  // A failed POST used to close the modal and reload as if it had saved.
  const [saveError, setSaveError] = useState(false);
  const now = new Date();
  const [form, setForm] = useState({
    month: String(now.getMonth() + 1),
    year: String(now.getFullYear()),
    jobs_completed: "",
    notes: "",
    issues: "",
    recommendations: "",
  });

  // Draft state. `drafted` only drives the "this is a draft, check it" banner —
  // nothing is persisted until the owner submits the form himself.
  const [drafting, setDrafting] = useState(false);
  const [drafted, setDrafted] = useState<DraftMeta | null>(null);
  const [draftError, setDraftError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    // Bounded: this route reads the sheet, which has answered in 160 s on a
    // cold instance. Without a timeout the page span until the platform killed
    // the function; now a stall becomes a line with a retry.
    const r = await timedJson<Report[]>(authedFetch, "/api/reports");
    setLoading(false);
    if (!r.ok) { setErr({ timedOut: r.timedOut }); return; }
    const list = Array.isArray(r.data) ? r.data : [];
    setReports(list);
    setErr(null);
    writeLastSeen(LAST_KEY, list);
  }, []);

  useEffect(() => {
    const snap = readLastSeen<Report[]>(LAST_KEY);
    if (Array.isArray(snap)) setReports(snap);
    load();
  }, [load]);

  /**
   * Pre-fill the form from the month's real numbers + the shared AI review.
   * This WRITES NOTHING — it fills the inputs and opens the form so the owner
   * can edit every line before pressing save.
   */
  async function generateDraft() {
    const month = `${form.year}-${String(Number(form.month)).padStart(2, "0")}`;
    setDrafting(true); setDraftError(false); setDrafted(null);
    // The slowest call on the page — a whole month of OEE plus the LLM review.
    // Bounded like every other read, so it cannot hang the button for ever.
    const r = await timedJson<{ ok: boolean; draft: Record<string, string>; meta: DraftMeta }>(
      authedFetch, `/api/reports/draft?month=${month}`,
    );
    setDrafting(false);
    if (!r.ok || !r.data?.ok) { setDraftError(true); return; }
    setForm((f) => ({ ...f, ...r.data.draft }));
    setDrafted(r.data.meta);
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(false);
    const res = await authedFetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    }).catch(() => null);
    setSaving(false);
    // The form STAYS open on a failure — the typed narrative is the owner's
    // work and must not disappear into a closed modal that saved nothing.
    if (!res || !res.ok) { setSaveError(true); return; }
    setShowForm(false);
    load();
  }

  async function handleDelete(rid: string) {
    if (!confirm(isAr ? "حذف هذا التقرير؟" : "Delete this report?")) return;
    await authedFetch(`/api/reports/${rid}`, { method: "DELETE" });
    load();
  }

  const months = isAr ? monthNamesAr : monthNames;

  return (
    <div className="max-w-3xl" dir={isAr ? "rtl" : "ltr"}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6 sm:mb-8">
        <h1 className="text-2xl font-bold text-gray-900">{tr.dashboard.reports}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={generateDraft}
            disabled={drafting}
            className="inline-flex items-center gap-1.5 border border-blue-600 text-blue-700 hover:bg-blue-50 active:bg-blue-100 disabled:opacity-50 text-sm px-4 py-2 min-h-11 sm:min-h-0 rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1"
          >
            <Sparkles size={15} />
            {drafting
              ? (isAr ? "بيجهّز…" : "Preparing…")
              : (isAr ? "جهّز مسودة" : "Prepare draft")}
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white shadow-sm text-sm px-4 py-2 min-h-11 sm:min-h-0 rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1"
          >
            <Plus size={15} />
            {tr.dashboard.newReport}
          </button>
        </div>
      </div>

      {err && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex flex-wrap items-center gap-3 text-sm text-red-700">
          <span>{err.timedOut ? p.common.timedOut : p.common.loadError}</span>
          <button
            onClick={load}
            className="inline-flex items-center min-h-11 sm:min-h-0 px-3 py-1.5 rounded-lg border border-red-300 bg-white text-red-700 hover:bg-red-100 active:bg-red-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
          >
            {p.common.retry}
          </button>
        </div>
      )}
      {/* A snapshot is on screen and the live answer is still coming. */}
      {loading && reports !== null && (
        <p className="text-xs text-gray-400 mb-3">{p.common.stillLoading}</p>
      )}

      {draftError && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {isAr ? "مقدرناش نجهّز المسودة — جرّب تاني." : "Could not prepare the draft — try again."}
        </div>
      )}

      {/* The draft is NOT saved. Say so plainly: it is the owner's job to read,
          correct and confirm it, and the numbers behind it can be incomplete. */}
      {drafted && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">
            {isAr
              ? "دي مسودة — راجعها وعدّلها قبل ما تحفظ. مش هتتحفظ لوحدها."
              : "This is a draft — review and edit it before saving. Nothing is saved automatically."}
          </p>
          <ul className="mt-1 space-y-0.5">
            <li>
              {isAr ? "المصدر: " : "Source: "}
              {drafted.provider === "rules"
                ? (isAr ? "قواعد ثابتة (مفيش مفتاح AI)" : "deterministic rules (no AI key set)")
                : drafted.provider}
              {" · "}
              {isAr ? `${drafted.runCount} تشغيلة` : `${drafted.runCount} runs`}
            </li>
            {!drafted.availabilityMeasured && (
              <li>{isAr ? "⚠ الجاهزية غير مقاسة لهذا الشهر." : "⚠ Availability is not measured for this month."}</li>
            )}
            {!drafted.qualityMeasured && (
              <li>{isAr ? "⚠ الجودة غير مقاسة لهذا الشهر." : "⚠ Quality is not measured for this month."}</li>
            )}
            {drafted.staleOpen > 0 && (
              <li>
                {isAr
                  ? `⚠ ${drafted.staleOpen} توقف مااتقفلش، فزمن التوقف أقل من الحقيقة.`
                  : `⚠ ${drafted.staleOpen} stoppage(s) never closed — downtime is under-reported.`}
              </li>
            )}
          </ul>
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6 mb-6 space-y-4"
        >
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{tr.dashboard.reportMonth}</label>
              <select
                value={form.month}
                onChange={(e) => setForm({ ...form, month: e.target.value })}
                className={inputCls}
              >
                {months.map((m, i) => (
                  <option key={m} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{tr.dashboard.reportYear}</label>
              <input
                type="number"
                value={form.year}
                onChange={(e) => setForm({ ...form, year: e.target.value })}
                min="2020"
                max="2100"
                className={inputCls}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{tr.dashboard.reportJobs}</label>
            <input
              type="number"
              value={form.jobs_completed}
              onChange={(e) => setForm({ ...form, jobs_completed: e.target.value })}
              min="0"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{tr.dashboard.reportNotes}</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={12}
              className={`${inputCls} resize-y leading-relaxed`}
              dir={isAr ? "rtl" : "ltr"}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{tr.dashboard.reportIssues}</label>
            <textarea
              value={form.issues}
              onChange={(e) => setForm({ ...form, issues: e.target.value })}
              rows={8}
              className={`${inputCls} resize-y leading-relaxed`}
              dir={isAr ? "rtl" : "ltr"}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{tr.dashboard.reportRecommendations}</label>
            <textarea
              value={form.recommendations}
              onChange={(e) => setForm({ ...form, recommendations: e.target.value })}
              rows={8}
              className={`${inputCls} resize-y leading-relaxed`}
              dir={isAr ? "rtl" : "ltr"}
            />
          </div>
          {saveError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {isAr ? "التقرير مااتحفظش — جرّب تاني." : "The report was not saved — try again."}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center justify-center bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-60 text-white shadow-sm text-sm px-5 py-2 min-h-11 sm:min-h-0 rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1"
            >
              {tr.dashboard.save}
            </button>
            <button
              type="button"
              onClick={() => { setSaveError(false); setShowForm(false); }}
              className="inline-flex items-center justify-center text-sm text-gray-700 px-5 py-2 min-h-11 sm:min-h-0 rounded-lg border border-gray-300 hover:bg-gray-50 active:bg-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1"
            >
              {tr.dashboard.cancel}
            </button>
          </div>
        </form>
      )}

      {reports === null ? (
        err ? null : <div className="flex justify-center py-10"><Spinner text={p.common.loading} /></div>
      ) : reports.length === 0 ? (
        <EmptyState text={tr.dashboard.noReports} />
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <div
              key={r.id}
              className="bg-white border border-gray-200 hover:border-blue-300 rounded-xl px-4 sm:px-5 py-4 flex items-center justify-between gap-3 group transition-colors"
            >
              <Link
                href={`/dashboard/reports/${r.id}`}
                className="flex items-center gap-3 flex-1 min-w-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1"
              >
                <FileText size={16} className="text-gray-300 shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">
                    {months[r.month - 1]} {r.year}
                  </p>
                  {r.jobs_completed != null && (
                    <p className="text-xs text-gray-400 mt-0.5 tabular-nums">
                      {r.jobs_completed.toLocaleString(isAr ? LOCALE_AR : "en-US")} {tr.dashboard.reportJobs.toLowerCase()}
                    </p>
                  )}
                </div>
              </Link>
              <div className="flex items-center gap-2 shrink-0">
                <Link href={`/dashboard/reports/${r.id}`} className="inline-flex items-center min-h-11 sm:min-h-0 px-2 rounded-lg text-xs text-blue-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1">
                  {tr.dashboard.viewReport}
                </Link>
                <button
                  onClick={() => handleDelete(r.id)}
                  title={isAr ? "حذف" : "Delete"}
                  aria-label={isAr ? "حذف" : "Delete"}
                  className="p-3 -m-2 min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg text-gray-300 hover:text-red-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
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
