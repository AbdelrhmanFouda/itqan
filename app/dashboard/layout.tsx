"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useLang } from "@/context/LangContext";
import { useAuth } from "@/context/AuthContext";
import { pd } from "@/lib/i18n.prod";
import { t } from "@/lib/i18n";
import { ad } from "@/lib/i18n.auth";
import { navFor, canAccess, landingFor, type NavKey } from "@/lib/roles";
import { Spinner } from "@/components/dashboard/ui";
import {
  LayoutDashboard, Settings, Box, FileText, Layers,
  BarChart3, CheckCircle2, Mail, Building2, Globe, Gauge, Menu, X, Sparkles, AlertTriangle, Clock,
} from "lucide-react";

const ICON: Record<NavKey, React.ElementType> = {
  overview: LayoutDashboard,
  finance: BarChart3,
  quality: CheckCircle2,
  sales: Mail,
  machines: Settings,
  molds: Box,
  products: Layers,
  jobs: FileText,
  production: Layers,
  hourly: Clock,
  issues: AlertTriangle,
  performance: Gauge,
  assistant: Sparkles,
  reports: FileText,
  clients: Building2,
  approvals: CheckCircle2,
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { lang, setLang } = useLang();
  const { user, profile, loading, profileLoading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isAr = lang === "ar";
  const p = pd[lang];
  const tr = t[lang];
  const a = ad[lang];
  // Mobile-only nav drawer (the sidebar is always visible from md up)
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => { setNavOpen(false); }, [pathname]);

  // Not signed in → login
  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  // Approved but visiting a route their role can't see → send to their landing
  useEffect(() => {
    if (!profile || profile.status !== "approved" || !profile.role) return;
    if (!canAccess(profile.role, pathname)) router.replace(landingFor(profile.role));
  }, [profile, pathname, router]);

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
  }

  const navLabel = (key: NavKey): string => {
    switch (key) {
      case "overview": return p.nav.overview;
      case "machines": return p.nav.machines;
      case "molds": return p.nav.molds;
      case "products": return isAr ? "المنتجات" : "Products";
      case "jobs": return p.nav.jobs;
      case "production": return p.nav.production;
      case "hourly": return isAr ? "الإنتاج بالساعة" : "Hourly";
      case "issues": return isAr ? "الأعطال" : "Issues";
      case "performance": return isAr ? "الأداء" : "Performance";
      case "assistant": return isAr ? "المساعد الذكي" : "Assistant";
      case "finance": return a.roles.finance;
      case "quality": return a.roles.quality;
      case "sales": return a.roles.sales;
      case "reports": return tr.dashboard.reports;
      case "clients": return tr.dashboard.clients;
      case "approvals": return isAr ? "الموافقات" : "Approvals";
    }
  };

  // ---- loading / gating states ----
  if (loading || (user && profileLoading)) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50"><Spinner text={p.common.loading} /></div>;
  }
  if (!user || !profile) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50"><Spinner text={a.auth.noProfileBody} /></div>;
  }

  if (profile.status !== "approved" || !profile.role) {
    const rejected = profile.status === "rejected";
    return (
      <StatusScreen
        isAr={isAr}
        title={rejected ? a.auth.rejectedTitle : a.auth.pendingTitle}
        body={rejected ? a.auth.rejectedBody : a.auth.pendingBody}
        email={profile.email}
        requestedLabel={
          profile.requestedRole && !rejected
            ? `${a.approvals.requested}: ${a.roles[profile.requestedRole]}`
            : undefined
        }
        signedInAs={a.auth.signedInAs}
        signOutLabel={a.auth.signOut}
        backLabel={a.auth.backToSite}
        onSignOut={handleSignOut}
        langBtn={isAr ? "EN" : "عربي"}
        onLang={() => setLang(isAr ? "en" : "ar")}
      />
    );
  }

  // ---- approved: full shell ----
  const items = navFor(profile.role);

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 h-14 flex items-center px-4 md:px-6 gap-3 md:gap-4 sticky top-0 z-40">
        <button
          onClick={() => setNavOpen((v) => !v)}
          className="md:hidden text-gray-600 hover:text-gray-900 p-1 -m-1"
          aria-label={navOpen ? "Close menu" : "Open menu"}
        >
          {navOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <Link href="/" className="font-bold text-gray-900 text-sm whitespace-nowrap">
          إتقان <span className="text-blue-600">Itqan</span>
        </Link>
        <span className="text-gray-300 text-xs hidden sm:inline">|</span>
        <span className="text-sm text-gray-500 hidden sm:inline">{a.auth.system}</span>
        <div className={`flex items-center gap-3 ${isAr ? "mr-auto" : "ml-auto"}`}>
          <span className="text-xs text-gray-400 hidden md:inline">
            {profile.email} · <span className="text-blue-600 font-medium">{a.roles[profile.role]}</span>
          </span>
          <button
            onClick={() => setLang(isAr ? "en" : "ar")}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 border border-gray-200 rounded px-2.5 py-1.5 transition-colors"
          >
            <Globe size={12} />
            {isAr ? "EN" : "عربي"}
          </button>
          <button
            onClick={handleSignOut}
            className="text-xs text-gray-500 hover:text-red-600 border border-gray-200 hover:border-red-200 rounded px-2.5 py-1.5 transition-colors"
          >
            {a.auth.signOut}
          </button>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Backdrop behind the mobile drawer */}
        {navOpen && (
          <div
            className="fixed inset-0 top-14 z-20 bg-black/30 md:hidden"
            onClick={() => setNavOpen(false)}
          />
        )}
        <aside
          className={`bg-white border-gray-200 p-4 flex flex-col gap-1 ${isAr ? "border-l" : "border-r"}
          fixed top-14 bottom-0 z-30 w-60 overflow-y-auto transition-transform duration-200
          ${isAr ? "right-0" : "left-0"}
          ${navOpen ? "translate-x-0 shadow-xl" : isAr ? "translate-x-full" : "-translate-x-full"}
          md:static md:z-auto md:w-48 md:translate-x-0 md:overflow-y-visible md:shadow-none md:transition-none`}
        >
          {items.map(({ href, key }) => {
            const Icon = ICON[key];
            const active = key === "overview" ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setNavOpen(false)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                  active ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                <Icon size={15} />
                {navLabel(key)}
              </Link>
            );
          })}
        </aside>

        <main className="flex-1 min-w-0 p-4 sm:p-6 md:p-8 overflow-auto">{children}</main>
      </div>
    </div>
  );
}

function StatusScreen(props: {
  isAr: boolean;
  title: string;
  body: string;
  email: string;
  requestedLabel?: string;
  signedInAs: string;
  signOutLabel: string;
  backLabel: string;
  onSignOut: () => void;
  langBtn: string;
  onLang: () => void;
}) {
  return (
    <div dir={props.isAr ? "rtl" : "ltr"} className="min-h-screen bg-gray-50 flex flex-col">
      <header className="h-14 flex items-center px-6">
        <Link href="/" className="font-bold text-gray-900 text-sm">
          إتقان <span className="text-blue-600">Itqan</span>
        </Link>
        <button
          onClick={props.onLang}
          className={`flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 border border-gray-200 rounded px-2.5 py-1.5 transition-colors ${props.isAr ? "mr-auto" : "ml-auto"}`}
        >
          <Globe size={12} />
          {props.langBtn}
        </button>
      </header>
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-sm bg-white border border-gray-200 rounded-2xl shadow-sm p-7 text-center">
          <div className="w-12 h-12 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto mb-4">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
          </div>
          <h1 className="text-lg font-bold text-gray-900 mb-2">{props.title}</h1>
          <p className="text-sm text-gray-500 leading-relaxed mb-4">{props.body}</p>
          {props.requestedLabel && (
            <p className="inline-block text-xs px-2.5 py-1 rounded-full border border-blue-200 bg-blue-50 text-blue-700 mb-4">
              {props.requestedLabel}
            </p>
          )}
          <p className="text-xs text-gray-400 mb-5">{props.signedInAs}: {props.email}</p>
          <button
            onClick={props.onSignOut}
            className="w-full border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm px-4 py-2 rounded-lg font-medium transition-colors"
          >
            {props.signOutLabel}
          </button>
          <Link href="/" className="block text-xs text-gray-400 hover:text-gray-600 mt-3">{props.backLabel}</Link>
        </div>
      </div>
    </div>
  );
}
