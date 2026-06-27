"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import { pd } from "@/lib/i18n.prod";
import { Settings, FileText, LayoutDashboard, Globe, Building2, Box, BarChart3 } from "lucide-react";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { lang, setLang } = useLang();
  const tr = t[lang];
  const p = pd[lang];
  const pathname = usePathname();
  const isAr = lang === "ar";

  const navItems = [
    { href: "/dashboard", label: p.nav.overview, icon: LayoutDashboard, exact: true },
    { href: "/dashboard/machines", label: p.nav.machines, icon: Settings },
    { href: "/dashboard/molds", label: p.nav.molds, icon: Box },
    { href: "/dashboard/jobs", label: p.nav.jobs, icon: FileText },
    { href: "/dashboard/production", label: p.nav.production, icon: BarChart3 },
    { href: "/dashboard/reports", label: tr.dashboard.reports, icon: FileText },
    { href: "/dashboard/clients", label: tr.dashboard.clients, icon: Building2 },
  ];

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top bar */}
      <header className="bg-white border-b border-gray-200 h-14 flex items-center px-6 gap-4 sticky top-0 z-40">
        <Link href="/" className="font-bold text-gray-900 text-sm">
          إتقان <span className="text-blue-600">Itqan</span>
        </Link>
        <span className="text-gray-300 text-xs">|</span>
        <span className="text-sm text-gray-500">{tr.dashboard.title}</span>
        <div className={`${isAr ? "mr-auto" : "ml-auto"}`}>
          <button
            onClick={() => setLang(isAr ? "en" : "ar")}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 border border-gray-200 rounded px-2.5 py-1.5 transition-colors"
          >
            <Globe size={12} />
            {isAr ? "EN" : "عربي"}
          </button>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Sidebar */}
        <aside className={`w-48 bg-white border-${isAr ? "l" : "r"} border-gray-200 p-4 flex flex-col gap-1`}>
          {navItems.map(({ href, label, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                  active
                    ? "bg-blue-50 text-blue-700 font-medium"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                <Icon size={15} />
                {label}
              </Link>
            );
          })}
        </aside>

        {/* Main content */}
        <main className="flex-1 p-8 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
