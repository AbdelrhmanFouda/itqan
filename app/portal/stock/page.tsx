"use client";
/**
 * «المخزون» — what the factory store holds for this customer.
 *
 * The second of the portal's two screens, beside «الأوامر». READ-ONLY: there
 * is nothing to tap that changes anything, and the server decides what is on
 * it — the route reads the client link off the account's own document and
 * answers with a pinned whitelist per item (lib/customer-stock.ts). This page
 * only fetches and frames; the cards are components/portal/stock-view.tsx.
 *
 * FRESHNESS, STATED — the same rule as the orders screen. The storage read is
 * a copy of any age up to its stale window, served at once and refreshed
 * behind. So the page prints the age with the SAME sentence /portal and
 * /dashboard/jobs use, refetches at most twice, eight seconds apart, and never
 * claims to be current.
 *
 * A failed refresh NEVER blanks the screen: what the device saw last time
 * paints first (per account — see `lastKeyFor`), the live answer replaces it,
 * and a refusal or a stall adds one line with a retry above the cards that are
 * already there.
 */
import { useEffect, useRef } from "react";
import { RefreshCw } from "lucide-react";
import { useLang } from "@/context/LangContext";
import { useAuth } from "@/context/AuthContext";
import { useCustomerAuth } from "@/context/CustomerAuthContext";
import { usePageTitle } from "@/components/dashboard/use-page-title";
import { cp } from "@/lib/i18n.portal";
import { authedFetch } from "@/lib/authed-fetch";
import { timedJson } from "@/components/dashboard/last-seen";
import { useRemembered } from "@/components/dashboard/use-remembered";
import { LoadError, Spinner } from "@/components/dashboard/ui";
import { StockView } from "@/components/portal/stock-view";
import { ageLabel, fill } from "@/lib/format";
import type { PortalStockLine } from "@/lib/customer-stock";

type Data = { lines: PortalStockLine[]; meta?: { dataAgeMs: number; stale: boolean } };

/**
 * The device snapshot, PER ACCOUNT — the same lock app/portal/page.tsx holds.
 * A snapshot paints before the live answer, so a device-wide key would show
 * the next customer to sign in on a shared browser the previous one's stock.
 * The name also matches `clearLastSeen()`'s pattern (`itqan.….last.<uid>`), so
 * signing out throws it away.
 */
const lastKeyFor = (uid: string) => `itqan.portal.stock.last.${uid}`;
/** Past this the page says «الأرقام من قبل …» and refetches on its own. */
const STALE_AFTER_MS = 60_000;

export default function PortalStock() {
  const { lang } = useLang();
  const c = cp[lang];
  const isAr = lang === "ar";
  usePageTitle(c.stock.title);
  const { user } = useAuth();
  const { account } = useCustomerAuth();
  // The shell renders this page only for a signed-in, linked account, so the
  // uid is always there; the fallback keeps the hook's key a constant string.
  const lastKey = lastKeyFor(user?.uid ?? "anon");
  /** WHOSE stock this is — the «العملاء» row(s) the factory linked the account to. */
  const companyNames = (account?.clients ?? []).map((cl) => cl.name).filter(Boolean).join(" · ");

  const loadRef = useRef<() => Promise<void>>(async () => {});
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const staleRefetches = useRef(0);

  const { data, loading, failed, reload } = useRemembered<Data>({
    key: lastKey,
    read: () => timedJson<Data>(authedFetch, "/api/portal/stock"),
    valid: (snap) => Array.isArray(snap?.lines),
    // A snapshot off this device carries no server-side age — showing the old
    // one would state a freshness nobody measured.
    hydrate: (snap) => ({ ...snap, meta: undefined }),
    onLoaded: (json) => {
      const old = (json.meta?.dataAgeMs ?? 0) > STALE_AFTER_MS || !!json.meta?.stale;
      if (!old) staleRefetches.current = 0;
      else if (!refetchTimer.current && staleRefetches.current < 2) {
        staleRefetches.current += 1;
        refetchTimer.current = setTimeout(() => { refetchTimer.current = null; loadRef.current(); }, 8000);
      }
    },
  });
  loadRef.current = reload;
  useEffect(() => () => { if (refetchTimer.current) clearTimeout(refetchTimer.current); }, []);

  const dataAge = data?.meta?.dataAgeMs ?? 0;
  // `stale` = the store did not answer this time and this is its last good
  // copy; the age line is the honest thing to show for it at any age.
  const showAge = dataAge > STALE_AFTER_MS || (!!data?.meta?.stale && dataAge > 0);

  return (
    <div className="max-w-2xl mx-auto" dir={isAr ? "rtl" : "ltr"}>
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <h1 className="text-2xl font-bold text-gray-900 min-w-0">{c.stock.title}</h1>
        <button
          onClick={() => reload()}
          disabled={loading}
          aria-label={c.common.retry}
          className="ms-auto inline-flex items-center justify-center min-w-11 min-h-11 rounded-lg text-gray-500 hover:bg-gray-100 active:bg-gray-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="-mt-3 mb-5 space-y-0.5">
        {companyNames && (
          <p className="text-sm text-gray-500">
            {c.home.company}: <span className="text-gray-700 font-medium">{companyNames}</span>
          </p>
        )}
        <p className="text-xs text-gray-400">{c.stock.note}</p>
      </div>

      {failed && (
        <LoadError
          variant="banner"
          className="mb-4"
          text={c.stock.loadError}
          retry={c.common.retry}
          onRetry={() => reload()}
          loading={loading}
        />
      )}
      {showAge && (
        <p className="text-xs text-amber-700 mb-3">{fill(c.home.dataAge, { age: ageLabel(dataAge, isAr) })}</p>
      )}

      {data ? (
        <StockView lines={data.lines} lang={lang} />
      ) : loading || !failed ? (
        <Spinner text={c.common.loading} />
      ) : null}
    </div>
  );
}
