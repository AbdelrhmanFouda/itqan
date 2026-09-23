"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Globe } from "lucide-react";
import { useLang } from "@/context/LangContext";
import { useAuth } from "@/context/AuthContext";
import { CustomerAuthProvider, useCustomerAuth } from "@/context/CustomerAuthContext";
import { cp } from "@/lib/i18n.portal";
import { isLinkedCustomer } from "@/lib/customer-link";
import { WHATSAPP_URL } from "@/lib/company";
import { Spinner } from "@/components/dashboard/ui";
import { StatusScreen } from "@/components/dashboard/status-screen";

/**
 * «بوابة العملاء» — the customer's shell.
 *
 * Its own light shell, NOT the dashboard's: no sidebar, no NAV, no role
 * lookup, nothing a buyer could tap into. Three screens come out of the gating
 * below and a customer never meets a 401 page or an error box:
 *
 *   waiting  — signed up, not linked to a company yet;
 *   closed   — refused, or approved once and stopped since (the owner's
 *              decision 17: a closed account keeps no history);
 *   the app  — approved AND linked.
 *
 * Revoked is told apart from never-approved by `approvedAt`: `revokeCustomer`
 * puts the status back to pending and clears the link, so the status alone
 * would say «قيد المراجعة» to someone whose access was deliberately stopped.
 */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <CustomerAuthProvider>
      <PortalShell>{children}</PortalShell>
    </CustomerAuthProvider>
  );
}

function PortalShell({ children }: { children: React.ReactNode }) {
  const { lang, setLang } = useLang();
  const { user, profile, loading, signOut } = useAuth();
  const { account, accountLoading } = useCustomerAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isAr = lang === "ar";
  const c = cp[lang];

  // The sign-in screen lives under /portal too, so it must not be gated by the
  // gate it exists to get past.
  const isLogin = pathname === "/portal/login";

  useEffect(() => {
    if (loading || isLogin) return;
    if (!user) router.replace("/portal/login");
  }, [loading, user, isLogin, router]);

  // A STAFF account that opens the portal goes to the dashboard — including a
  // pending one, whose own waiting card lives there and names the role they
  // asked for. Having a `users/{uid}` document at all is what makes them staff.
  useEffect(() => {
    if (loading || isLogin || !user || !profile) return;
    router.replace("/dashboard");
  }, [loading, user, profile, isLogin, router]);

  async function handleSignOut() {
    await signOut();
    router.replace("/portal/login");
  }

  const toggleLang = () => setLang(isAr ? "en" : "ar");

  if (isLogin) return <>{children}</>;

  if (loading || !user || (user && profile)) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50"><Spinner text={c.gate.checking} /></div>;
  }
  if (accountLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50"><Spinner text={c.gate.checking} /></div>;
  }

  const stopped = account
    ? account.status === "rejected" || (account.status === "pending" && !!account.approvedAt)
    : false;

  if (stopped) {
    return (
      <StatusScreen
        isAr={isAr}
        tone="red"
        title={c.gate.closedTitle}
        body={c.gate.closedBody}
        email={user.email ?? ""}
        signedInAs={c.common.signedInAs}
        signOutLabel={c.common.signOut}
        backLabel={c.common.backToSite}
        onSignOut={handleSignOut}
        langBtn={c.common.langToggle}
        onLang={toggleLang}
        extra={<WhatsAppLink label={c.common.whatsapp} />}
      />
    );
  }

  // Approved but not yet linked is still waiting: without a company there is
  // nothing to show, and `requireCustomer` would refuse every call anyway.
  if (!isLinkedCustomer(account)) {
    return (
      <StatusScreen
        isAr={isAr}
        title={c.gate.pendingTitle}
        body={c.gate.pendingBody}
        email={user.email ?? ""}
        requestedLabel={
          account?.requestedClient ? `${c.gate.requestedCompany}: ${account.requestedClient}` : undefined
        }
        signedInAs={c.common.signedInAs}
        signOutLabel={c.common.signOut}
        backLabel={c.common.backToSite}
        onSignOut={handleSignOut}
        langBtn={c.common.langToggle}
        onLang={toggleLang}
        extra={<WhatsAppLink label={c.common.whatsapp} />}
      />
    );
  }

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 h-14 flex items-center px-4 sm:px-6 gap-3 sticky top-0 z-40">
        <Link href="/portal" className="font-bold text-gray-900 text-sm whitespace-nowrap">
          إتقان <span className="text-blue-600">Itqan</span>
        </Link>
        <span className="text-gray-300 text-xs hidden sm:inline">|</span>
        <span className="text-sm text-gray-500 hidden sm:inline">{c.common.portal}</span>
        <div className="flex items-center gap-2 sm:gap-3 ms-auto">
          <span className="text-xs text-gray-400 hidden md:inline">{user.email}</span>
          <button
            onClick={toggleLang}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 border border-gray-200 rounded px-2.5 py-1.5 min-h-11 sm:min-h-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1"
          >
            <Globe size={12} />
            {c.common.langToggle}
          </button>
          <button
            onClick={handleSignOut}
            className="text-xs text-gray-500 hover:text-red-600 border border-gray-200 hover:border-red-200 rounded px-2.5 py-1.5 min-h-11 sm:min-h-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1"
          >
            {c.common.signOut}
          </button>
        </div>
      </header>
      <main className="flex-1 min-w-0 px-4 py-5 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}

function WhatsAppLink({ label }: { label: string }) {
  return (
    <a
      href={WHATSAPP_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="w-full mb-4 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white text-sm px-4 py-2 min-h-11 inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40 focus-visible:ring-offset-1"
    >
      {label}
    </a>
  );
}
