"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useLang } from "@/context/LangContext";
import { isArabicOnlyPath } from "@/lib/arabic-only";
import { useAuth } from "@/context/AuthContext";
import { pd } from "@/lib/i18n.prod";
import { t } from "@/lib/i18n";
import { ad } from "@/lib/i18n.auth";
import { cp } from "@/lib/i18n.portal";
import { navFor, canAccess, landingFor, type NavKey } from "@/lib/roles";
import { Spinner } from "@/components/dashboard/ui";
// Lifted out of this file on 2026-09-23 so the customer portal can show the
// same card with its own words. The look here is unchanged.
import { StatusScreen } from "@/components/dashboard/status-screen";
import {
  LayoutDashboard, Settings, Box, FileText, Layers,
  BarChart3, CheckCircle2, Mail, Building2, Globe, Gauge, Menu, X, Sparkles, AlertTriangle, Warehouse,
  TimerOff, Boxes, Inbox, Replace,
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
  requests: Inbox,
  production: Layers,
  downtime: TimerOff,
  issues: AlertTriangle,
  storage: Warehouse,
  stock: Boxes,
  changeover: Replace,
  performance: Gauge,
  assistant: Sparkles,
  reports: FileText,
  clients: Building2,
  approvals: CheckCircle2,
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { lang, setLang } = useLang();
  const { user, profile, loading, profileLoading, isCustomer, signOut } = useAuth();
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

  // A CUSTOMER who lands here → the portal (2026-09-23). They hold no staff
  // profile, so without this they would sit on "Setting up your account…"
  // forever — the branch below waits for a document that is never written.
  useEffect(() => {
    if (!loading && user && isCustomer) router.replace("/portal");
  }, [loading, user, isCustomer, router]);

  // Approved but visiting a route their role can't see → send to their landing
  useEffect(() => {
    if (!profile || profile.status !== "approved" || !profile.role) return;
    if (!canAccess(profile.role, pathname)) router.replace(landingFor(profile.role));
  }, [profile, pathname, router]);

  // Warm the function instance's copies of the core sheet tabs once per shell
  // mount (2026-09-10): by the time a page is tapped, the reads it needs are
  // usually done or in flight. /api/warm answers at once and returns nothing.
  const warmed = useRef(false);
  useEffect(() => {
    if (warmed.current || !profile || profile.status !== "approved") return;
    warmed.current = true;
    fetch("/api/warm").catch(() => {});
  }, [profile]);

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
  }

  const navLabel = (key: NavKey): string => {
    switch (key) {
      case "overview": return p.nav.overview;
      case "machines": return p.nav.machines;
      case "molds": return p.nav.molds;
      case "products": return p.nav.products;
      case "jobs": return p.nav.jobs;
      // The portal's own namespace — the staff half of lib/i18n.portal.ts.
      case "requests": return cp[lang].staff.reqs.nav;
      case "production": return p.nav.production;
      case "downtime": return p.nav.downtime;
      case "issues": return p.nav.issues;
      case "storage": return p.nav.storage;
      case "stock": return p.nav.stock;
      case "changeover": return p.nav.changeover;
      case "performance": return p.nav.performance;
      case "assistant": return p.nav.assistant;
      case "finance": return a.roles.finance;
      case "quality": return a.roles.quality;
      case "sales": return a.roles.sales;
      case "reports": return tr.dashboard.reports;
      case "clients": return tr.dashboard.clients;
      case "approvals": return p.nav.approvals;
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
        langBtn={p.common.langToggle}
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
          // 28px measured. This is the only way into the navigation on a
          // phone, so it is the one control that must never be a near-miss.
          className="md:hidden text-gray-600 hover:text-gray-900 flex items-center justify-center min-w-11 min-h-11 -ms-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          aria-label={navOpen ? p.common.closeMenu : p.common.openMenu}
        >
          {navOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <Link href="/" className="font-bold text-gray-900 text-sm whitespace-nowrap">
          إتقان <span className="text-blue-600">Itqan</span>
        </Link>
        <span className="text-gray-300 text-xs hidden sm:inline">|</span>
        <span className="text-sm text-gray-500 hidden sm:inline">{a.auth.system}</span>
        <div className="flex items-center gap-3 ms-auto">
          <span className="text-xs text-gray-400 hidden md:inline">
            {profile.email} · <span className="text-blue-600 font-medium">{a.roles[profile.role]}</span>
          </span>
          {/* Hidden on the Arabic-only routes: the downtime capture page is
              always Arabic, so a toggle there would be a control that does
              nothing. Better absent than dead. */}
          {!isArabicOnlyPath(pathname) && (
            <button
              onClick={() => setLang(isAr ? "en" : "ar")}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 border border-gray-200 rounded px-2.5 py-1.5 min-h-10 sm:min-h-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1"
            >
              <Globe size={12} />
              {p.common.langToggle}
            </button>
          )}
          <button
            onClick={handleSignOut}
            className="text-xs text-gray-500 hover:text-red-600 border border-gray-200 hover:border-red-200 rounded px-2.5 py-1.5 min-h-10 sm:min-h-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1"
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
          className={`bg-white border-gray-200 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:pb-4 flex flex-col gap-1 ${isAr ? "border-l" : "border-r"}
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
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2.5 px-3 py-2 min-h-11 md:min-h-0 rounded-lg text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
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
