"use client";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Settings, FileText, ChevronRight } from "lucide-react";

export default function DashboardPage() {
  const { lang } = useLang();
  const tr = t[lang];
  const isAr = lang === "ar";
  const [machines, setMachines] = useState<{ id: number }[]>([]);
  const [reports, setReports] = useState<{ id: number; month: number; year: number }[]>([]);

  useEffect(() => {
    fetch("/api/machines").then((r) => r.json()).then(setMachines).catch(() => {});
    fetch("/api/reports").then((r) => r.json()).then(setReports).catch(() => {});
  }, []);

  const monthNames = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December",
  ];
  const lastReport = reports[0];

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-8">{tr.dashboard.overview}</h1>

      <div className="grid sm:grid-cols-2 gap-5 mb-10">
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <p className="text-sm text-gray-500 mb-1">{tr.dashboard.totalMachines}</p>
          <p className="text-4xl font-bold text-gray-900">{machines.length}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <p className="text-sm text-gray-500 mb-1">{tr.dashboard.lastReport}</p>
          <p className="text-2xl font-bold text-gray-900">
            {lastReport
              ? `${monthNames[lastReport.month - 1]} ${lastReport.year}`
              : tr.dashboard.none}
          </p>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-5">
        <Link
          href="/dashboard/machines"
          className="bg-white border border-gray-200 hover:border-blue-300 rounded-xl p-6 flex items-center justify-between group transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center">
              <Settings size={16} className="text-blue-600" />
            </div>
            <span className="font-medium text-gray-900">{tr.dashboard.machines}</span>
          </div>
          <ChevronRight size={16} className={`text-gray-400 group-hover:text-blue-500 transition-colors ${isAr ? "rotate-180" : ""}`} />
        </Link>

        <Link
          href="/dashboard/reports"
          className="bg-white border border-gray-200 hover:border-blue-300 rounded-xl p-6 flex items-center justify-between group transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center">
              <FileText size={16} className="text-blue-600" />
            </div>
            <span className="font-medium text-gray-900">{tr.dashboard.reports}</span>
          </div>
          <ChevronRight size={16} className={`text-gray-400 group-hover:text-blue-500 transition-colors ${isAr ? "rotate-180" : ""}`} />
        </Link>
      </div>
    </div>
  );
}
