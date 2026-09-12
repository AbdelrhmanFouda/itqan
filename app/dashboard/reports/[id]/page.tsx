"use client";
import { usePageTitle } from "@/components/dashboard/use-page-title";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import { pd } from "@/lib/i18n.prod";
import { useCallback, useEffect, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { authedFetch } from "@/lib/authed-fetch";
import { timedJson } from "@/components/dashboard/last-seen";
import { Spinner, LoadError } from "@/components/dashboard/ui";
import { LOCALE_AR } from "@/lib/format";

type Report = {
  id: string;
  month: number;
  year: number;
  jobs_completed: number | null;
  notes: string;
  issues: string;
  recommendations: string;
  created_at: string | null;
};

const monthNames = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const monthNamesAr = [
  "يناير","فبراير","مارس","أبريل","مايو","يونيو",
  "يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر",
];

export default function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { lang } = useLang();
  const tr = t[lang];
  const p = pd[lang];
  const isAr = lang === "ar";
  const [report, setReport] = useState<Report | null>(null);
  // A failed read used to leave the page spinning for ever: the response was
  // never checked for `ok` and the fetch had no timeout, so a 401 or a stalled
  // sheet both rendered as «جارٍ التحميل…» until the function was killed.
  const [err, setErr] = useState<null | { timedOut: boolean }>(null);
  usePageTitle(report ? `${tr.dashboard.reportFor} ${(isAr ? monthNamesAr : monthNames)[report.month - 1]} ${report.year}` : tr.dashboard.reports);

  const load = useCallback(async () => {
    setErr(null);
    const r = await timedJson<Report>(authedFetch, `/api/reports/${id}`);
    if (!r.ok) { setErr({ timedOut: r.timedOut }); return; }
    setReport(r.data);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function handleDelete() {
    if (!confirm(isAr ? "حذف هذا التقرير؟" : "Delete this report?")) return;
    await authedFetch(`/api/reports/${id}`, { method: "DELETE" });
    router.push("/dashboard/reports");
  }

  if (!report) {
    if (err) {
      return (
        <div className="max-w-2xl" dir={isAr ? "rtl" : "ltr"}>
          <Link
            href="/dashboard/reports"
            className="inline-flex items-center min-h-11 sm:min-h-0 mb-4 sm:mb-6 rounded-lg text-sm text-blue-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1"
          >
            {isAr ? "→ التقارير" : "← Reports"}
          </Link>
          <LoadError
            variant="banner"
            text={err.timedOut ? p.common.timedOut : p.common.loadError}
            retry={p.common.retry}
            onRetry={load}
          />
        </div>
      );
    }
    return (
      <div className="flex justify-center py-16">
        <Spinner text={isAr ? "جارٍ التحميل…" : "Loading…"} />
      </div>
    );
  }

  const months = isAr ? monthNamesAr : monthNames;

  return (
    <div className="max-w-2xl" dir={isAr ? "rtl" : "ltr"}>
      <Link
        href="/dashboard/reports"
        className="inline-flex items-center min-h-11 sm:min-h-0 mb-4 sm:mb-6 rounded-lg text-sm text-blue-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1"
      >
        {isAr ? "→ التقارير" : "← Reports"}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900">
            {tr.dashboard.reportFor} {months[report.month - 1]} {report.year}
          </h1>
          {report.created_at && (
            <p className="text-xs text-gray-400 mt-1">
              {new Date(report.created_at).toLocaleDateString(isAr ? LOCALE_AR : "en-GB", {
                year: "numeric", month: "long", day: "numeric",
              })}
            </p>
          )}
        </div>
        <button
          onClick={handleDelete}
          title={isAr ? "حذف" : "Delete"}
          className="inline-flex items-center gap-1.5 shrink-0 text-xs text-red-500 hover:text-white hover:bg-red-500 border border-red-200 hover:border-red-500 px-3 py-1.5 min-h-11 sm:min-h-0 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 focus-visible:ring-offset-1"
        >
          <Trash2 size={13} />
          {isAr ? "حذف" : "Delete"}
        </button>
      </div>

      <div className="space-y-5">
        {report.jobs_completed != null && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 sm:p-5 text-center">
            <p className="text-3xl sm:text-4xl font-bold text-blue-700 tabular-nums">
              {report.jobs_completed.toLocaleString(isAr ? LOCALE_AR : "en-US")}
            </p>
            <p className="text-sm text-blue-500 mt-1">{tr.dashboard.reportJobs}</p>
          </div>
        )}

        {[
          { label: tr.dashboard.reportNotes, value: report.notes },
          { label: tr.dashboard.reportIssues, value: report.issues },
          { label: tr.dashboard.reportRecommendations, value: report.recommendations },
        ]
          .filter((s) => s.value?.trim())
          .map((s) => (
            <div key={s.label} className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{s.label}</p>
              <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{s.value}</p>
            </div>
          ))}
      </div>
    </div>
  );
}
