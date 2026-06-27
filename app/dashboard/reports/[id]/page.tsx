"use client";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import { useEffect, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

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
  const isAr = lang === "ar";
  const [report, setReport] = useState<Report | null>(null);

  useEffect(() => {
    fetch(`/api/reports/${id}`)
      .then((r) => r.json())
      .then(setReport)
      .catch(() => {});
  }, [id]);

  async function handleDelete() {
    if (!confirm(isAr ? "حذف هذا التقرير؟" : "Delete this report?")) return;
    await fetch(`/api/reports/${id}`, { method: "DELETE" });
    router.push("/dashboard/reports");
  }

  if (!report) return <div className="text-sm text-gray-400">Loading...</div>;

  const months = isAr ? monthNamesAr : monthNames;

  return (
    <div className="max-w-2xl">
      <Link href="/dashboard/reports" className="text-sm text-blue-600 hover:underline mb-6 inline-block">
        {isAr ? "→ التقارير" : "← Reports"}
      </Link>

      <div className={`flex items-start justify-between gap-3 mb-6 ${isAr ? "flex-row-reverse" : ""}`}>
        <div dir={isAr ? "rtl" : "ltr"}>
          <h1 className="text-2xl font-bold text-gray-900">
            {tr.dashboard.reportFor} {months[report.month - 1]} {report.year}
          </h1>
          {report.created_at && (
            <p className="text-xs text-gray-400 mt-1">
              {new Date(report.created_at).toLocaleDateString(isAr ? "ar-EG" : "en-GB", {
                year: "numeric", month: "long", day: "numeric",
              })}
            </p>
          )}
        </div>
        <button
          onClick={handleDelete}
          title={isAr ? "حذف" : "Delete"}
          className="flex items-center gap-1.5 text-xs text-red-500 hover:text-white hover:bg-red-500 border border-red-200 hover:border-red-500 px-2.5 py-1.5 rounded-lg transition-colors"
        >
          <Trash2 size={13} />
          {isAr ? "حذف" : "Delete"}
        </button>
      </div>

      <div className="space-y-5">
        {report.jobs_completed != null && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-5 text-center">
            <p className="text-4xl font-bold text-blue-700">{report.jobs_completed}</p>
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
            <div key={s.label} dir={isAr ? "rtl" : "ltr"} className="bg-white border border-gray-100 rounded-xl p-5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{s.label}</p>
              <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{s.value}</p>
            </div>
          ))}
      </div>
    </div>
  );
}
