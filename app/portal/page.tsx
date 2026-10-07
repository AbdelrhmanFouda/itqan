"use client";
/**
 * «أوامرك» — the one screen a customer opens instead of phoning.
 *
 * A big «اطلب الآن» and, under it, cards. No tabs, no filters, no dashboard:
 * about ten of the factory's sixty real customers have ever had a work-order
 * row, so most people who sign in will correctly see nothing, and the empty
 * state is written for them rather than left as a blank list that reads like a
 * broken site.
 *
 * ONE CARD PER THING ORDERED. A request and the work order it became are the
 * same card, merged on the `[REQ-…]` marker the approval leaves in the order's
 * notes — so a card carries a person from «تم استلام طلبك» to «اكتمل الإنتاج»
 * without ever showing two rows to reconcile. `cardStep()` in
 * lib/customer-requests.ts decides which of the six lines a card shows.
 *
 * «تم إنتاج» — HOW MANY WERE MADE (2026-10-07, owner's word after signing in
 * as a customer: "I only see my orders, not how many were made"). Until then
 * the count was left out on purpose: the staff figure credits production to an
 * order by product NAME alone, with no client term and no end date, so two
 * orders for one product each received the full total. The number on this
 * screen is a different one — lib/customer-progress.ts counts only the shift
 * rows whose own client cell is this customer's, inside this one order's
 * window, and sends `null` where that cannot be said honestly. `null` prints
 * NOTHING here; a number that is sometimes wrong is still worse than none.
 * What a card may say is decided by `progressLine()` in that module. Never
 * here: scrap, the machine, the operator, shift dates, a daily rate, or a
 * finish date worked out from one. «متوقف» likewise reads as «جاري التشغيل» —
 * a stoppage is a machine problem, not an order state.
 *
 * FRESHNESS, STATED. A copy of any age up to the stale window is served at
 * once and refreshed behind, so a first look after a quiet period can be hours
 * old and it is the second look that is current. The page prints the age with
 * the SAME sentence /dashboard/jobs uses and refetches at most twice, eight
 * seconds apart. The word «مباشر» appears nowhere.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Plus, RefreshCw } from "lucide-react";
import { useLang } from "@/context/LangContext";
import { useAuth } from "@/context/AuthContext";
import { useCustomerAuth } from "@/context/CustomerAuthContext";
import { usePageTitle } from "@/components/dashboard/use-page-title";
import { cp } from "@/lib/i18n.portal";
import { COMPANY } from "@/lib/company";
import { authedFetch } from "@/lib/authed-fetch";
import { timedJson } from "@/components/dashboard/last-seen";
import { useRemembered } from "@/components/dashboard/use-remembered";
import { Btn, EmptyState, LoadError, Modal, Spinner } from "@/components/dashboard/ui";
import { ageLabel, fill, fmtNum, fmtPct } from "@/lib/format";
import { formatDate } from "@/lib/dates";
import {
  cardStep, UNIT_PIECES, type CardStep, type PortalOrder, type PortalOrderStatus, type PortalRequest,
} from "@/lib/customer-requests";
import { orderedTotalPieces, progressLine, type ProgressLine } from "@/lib/customer-progress";

type Data = { requests: PortalRequest[]; orders: PortalOrder[]; meta?: { dataAgeMs: number } };

/**
 * The device snapshot, PER ACCOUNT.
 *
 * It was a device-wide constant until the 2026-09-23 review: the snapshot
 * paints on mount, before the live answer arrives, so on a shared browser the
 * next customer to sign in saw the previous one's product names, quantities,
 * reference numbers and delivery dates — the one boundary this whole build
 * exists to hold, broken on the client after the server had filtered
 * correctly. `signOut()` clears every snapshot as well (AuthContext); this is
 * the lock that also covers a browser nobody signed out of.
 */
const lastKeyFor = (uid: string) => `itqan.portal.last.${uid}`;
/** Past this the page says «الأرقام من قبل …» and refetches once on its own. */
const STALE_AFTER_MS = 60_000;

/** One thing the customer ordered — a request, an order, or the two merged. */
type Card = {
  key: string;
  reqId: string;
  product: string;
  /** What they typed, in their own unit; 0 for an order the factory entered. */
  qtyAsked: number;
  unit: string;
  qtyKg: number;
  qtyPieces: number | null;
  /** The date they asked for; "" when there was no request. */
  wantedDate: string;
  /** The date the factory promised, from «أوامر العمل»!J. */
  dueDate: string;
  step: CardStep;
  /** The date beside the status line — "" when nothing in the sheet says. */
  stepDate: string;
  jobCode: string;
  rejectReason: string;
  canCancel: boolean;
  /** What the list is sorted by — newest first. */
  sortKey: string;
  /** Pieces made for the work order behind this card; null when there is no
   *  order yet, or when the server could not attribute a count to it. */
  produced: number | null;
  /** That order's status as the customer sees it; null without an order. */
  orderStatus: PortalOrderStatus | null;
};

/**
 * The count off an order, or null. A snapshot this device saved before
 * 2026-10-07 has no such key — it must read as "not known", never as zero.
 */
const madeCountOf = (o: PortalOrder | null): number | null =>
  o && typeof o.produced === "number" && Number.isFinite(o.produced) && o.produced >= 0 ? o.produced : null;

/**
 * The ordered quantity in PIECES the count is measured against, or null when
 * the order is known in kilograms only (no total, no bar). Decided by
 * `orderedTotalPieces()`: the WORK ORDER's quantity — the factory may have
 * approved, or later edited, a different quantity from the one typed — and the
 * typed number only where the two agree within rounding.
 */
const totalPiecesOf = (card: Card): number | null =>
  orderedTotalPieces(card.unit === UNIT_PIECES ? card.qtyAsked : null, card.qtyPieces, card.qtyKg);

const progressOf = (card: Card): ProgressLine =>
  card.step === "rejected" || card.step === "cancelled"
    ? { kind: "none" }
    : progressLine(card.produced, card.orderStatus, totalPiecesOf(card));

/** «yyyy-mm-dd HH:MM» → «yyyy-mm-dd». The stamp is text, never re-parsed. */
const dayOf = (stamp: string): string => (stamp || "").slice(0, 10);

function buildCards(requests: readonly PortalRequest[], orders: readonly PortalOrder[]): Card[] {
  const byReq = new Map<string, PortalOrder>();
  for (const o of orders) if (o.reqId) byReq.set(o.reqId, o);

  const cards: Card[] = requests.map((r) => {
    const order = byReq.get(r.reqId) ?? null;
    const step = cardStep(r.state, order);
    const stepDate =
      step === "submitted" ? dayOf(r.submittedAt)
      : step === "rejected" ? dayOf(r.decidedAt)
      : step === "approved" || step === "running" ? (order?.startDate || dayOf(r.decidedAt))
      : "";
    return {
      key: `r:${r.reqId}`,
      reqId: r.reqId,
      product: r.product,
      qtyAsked: r.qtyAsked,
      unit: r.unit,
      qtyKg: order?.qtyKg || r.qtyKg,
      qtyPieces: order?.qtyPieces ?? null,
      wantedDate: r.wantedDate,
      dueDate: order?.dueDate ?? "",
      step,
      stepDate,
      jobCode: order?.code || r.jobCode,
      rejectReason: r.rejectReason,
      canCancel: r.state === "pending",
      sortKey: r.submittedAt || r.wantedDate,
      produced: madeCountOf(order),
      orderStatus: order?.status ?? null,
    };
  });

  // Orders the factory entered itself — every customer's history before the
  // portal existed, and anything taken by phone since. They carry no request,
  // so they start at «تمت الموافقة».
  const claimed = new Set(cards.map((c) => c.reqId).filter(Boolean));
  for (const o of orders) {
    if (o.reqId && claimed.has(o.reqId)) continue;
    cards.push({
      key: `o:${o.code || o.product}:${o.startDate}:${o.dueDate}`,
      reqId: "",
      product: o.product,
      qtyAsked: 0,
      unit: "",
      qtyKg: o.qtyKg,
      qtyPieces: o.qtyPieces,
      wantedDate: "",
      dueDate: o.dueDate,
      step: cardStep("accepted", o),
      stepDate: o.startDate,
      jobCode: o.code,
      rejectReason: "",
      canCancel: false,
      sortKey: o.startDate || o.dueDate,
      produced: madeCountOf(o),
      orderStatus: o.status,
    });
  }

  return cards.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));
}

const stepTone: Record<CardStep, string> = {
  submitted: "bg-amber-50 text-amber-800 border-amber-200",
  approved: "bg-blue-50 text-blue-800 border-blue-200",
  running: "bg-blue-50 text-blue-800 border-blue-200",
  done: "bg-emerald-50 text-emerald-800 border-emerald-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
  cancelled: "bg-gray-100 text-gray-600 border-gray-200",
};

/**
 * «تم إنتاج 1,350 من 5,000 قطعة» and, when the ordered piece count is known,
 * a thin bar with the percentage beside it.
 *
 * The fill is a block inside a container that inherits the page's `dir`, so it
 * grows from the START edge — the right in Arabic, the left in English — with
 * no direction-specific class. The percentage is capped at 100 by
 * `progressLine()`, so the fill cannot overflow the track; the sentence above
 * it still states the real count. Hand-built, like every chart on the site.
 */
function ProducedLine({ text, pct, pctText }: { text: string; pct: number | null; pctText: string }) {
  return (
    <div className="mt-2">
      <p className="text-sm font-medium text-gray-900">{text}</p>
      {pct !== null && (
        <div className="mt-1.5 flex items-center gap-2">
          <div
            role="progressbar"
            aria-label={text}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-valuetext={pctText}
            className="h-1.5 flex-1 min-w-0 rounded-full bg-gray-100 overflow-hidden"
          >
            <div
              className={`h-full rounded-full ${pct >= 100 ? "bg-emerald-600" : "bg-blue-600"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-xs text-gray-500 tabular-nums shrink-0">
            <bdi dir="ltr">{pctText}</bdi>
          </span>
        </div>
      )}
    </div>
  );
}

export default function PortalHome() {
  const { lang } = useLang();
  const c = cp[lang];
  const isAr = lang === "ar";
  usePageTitle(c.home.title);
  const { user } = useAuth();
  const { account } = useCustomerAuth();
  // The shell renders this page only for a signed-in, linked account, so the
  // uid is always there; the fallback keeps the hook's key a constant string.
  const lastKey = lastKeyFor(user?.uid ?? "anon");
  /** The «العملاء» row(s) the factory linked this account to — see below. */
  const companyNames = (account?.clients ?? []).map((cl) => cl.name).filter(Boolean).join(" · ");

  const [cancelling, setCancelling] = useState<Card | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelErr, setCancelErr] = useState("");

  const loadRef = useRef<() => Promise<void>>(async () => {});
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const staleRefetches = useRef(0);

  const { data, loading, failed, reload } = useRemembered<Data>({
    key: lastKey,
    read: () => timedJson<Data>(authedFetch, "/api/portal/orders"),
    valid: (snap) => Array.isArray(snap?.requests) && Array.isArray(snap?.orders),
    // A snapshot off this device carries no server-side age — showing the old
    // one would state a freshness nobody measured.
    hydrate: (snap) => ({ ...snap, meta: undefined }),
    onLoaded: (json) => {
      const age = json.meta?.dataAgeMs ?? 0;
      if (age <= STALE_AFTER_MS) staleRefetches.current = 0;
      else if (!refetchTimer.current && staleRefetches.current < 2) {
        staleRefetches.current += 1;
        refetchTimer.current = setTimeout(() => { refetchTimer.current = null; loadRef.current(); }, 8000);
      }
    },
  });
  loadRef.current = reload;
  useEffect(() => () => { if (refetchTimer.current) clearTimeout(refetchTimer.current); }, []);

  const cards = useMemo(
    () => buildCards(data?.requests ?? [], data?.orders ?? []),
    [data?.requests, data?.orders],
  );
  const dataAge = data?.meta?.dataAgeMs ?? 0;
  /** The one line that says where the counts come from — printed only when a
   *  card actually shows one. */
  const showsProgress = useMemo(() => cards.some((card) => progressOf(card).kind !== "none"), [cards]);

  const doCancel = useCallback(async () => {
    if (!cancelling) return;
    setBusy(true);
    setCancelErr("");
    try {
      const res = await authedFetch(`/api/portal/requests/${encodeURIComponent(cancelling.reqId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      if (!res.ok) {
        // 409 means the factory answered it while this screen was open — a
        // different sentence, because "try again" would never work.
        setCancelErr(res.status === 409 ? c.home.cancelGone : c.home.cancelFailed);
        return;
      }
      setCancelling(null);
      await reload();
    } catch {
      setCancelErr(c.home.cancelFailed);
    } finally {
      setBusy(false);
    }
  }, [cancelling, reload, c.home.cancelFailed, c.home.cancelGone]);

  const unitLabel = (unit: string) => (unit === UNIT_PIECES ? c.units.pieces : c.units.kg);
  const waUrl = (ref: string) =>
    `https://wa.me/${COMPANY.phone.wa}?text=${encodeURIComponent(fill(c.home.waText, { ref }))}`;

  return (
    <div className="max-w-2xl mx-auto" dir={isAr ? "rtl" : "ltr"}>
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <h1 className="text-2xl font-bold text-gray-900 min-w-0">{c.home.title}</h1>
        <button
          onClick={() => reload()}
          disabled={loading}
          aria-label={c.common.retry}
          className="ms-auto inline-flex items-center justify-center min-w-11 min-h-11 rounded-lg text-gray-500 hover:bg-gray-100 active:bg-gray-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* WHOSE order book this is. The approvals screen links an account to an
          «العملاء» row by hand, and a mis-link is the one mistake it can make —
          invisible to the buyer unless the name is on the screen they read. */}
      {companyNames && (
        <p className="text-sm text-gray-500 -mt-3 mb-5">
          {c.home.company}: <span className="text-gray-700 font-medium">{companyNames}</span>
        </p>
      )}

      <Link
        href="/portal/new"
        className="w-full mb-5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-base font-semibold px-5 py-4 min-h-14 inline-flex items-center justify-center gap-2 rounded-2xl shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1"
      >
        <Plus size={18} />
        {c.home.newOrder}
      </Link>

      {failed && (
        <LoadError
          variant="banner"
          className="mb-4"
          text={c.home.loadError}
          retry={c.common.retry}
          onRetry={() => reload()}
          loading={loading}
        />
      )}
      {dataAge > STALE_AFTER_MS && (
        <p className="text-xs text-amber-700 mb-3">{fill(c.home.dataAge, { age: ageLabel(dataAge, isAr) })}</p>
      )}

      {!data && loading ? (
        <Spinner text={c.common.loading} />
      ) : cards.length === 0 ? (
        <div className="space-y-4">
          <EmptyState text={c.home.empty} sub={c.home.emptySub} />
          <a
            href={waUrl("")}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full bg-green-600 hover:bg-green-700 active:bg-green-800 text-white text-sm px-5 py-2 min-h-11 inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
          >
            {c.common.whatsapp}
          </a>
        </div>
      ) : (
        <>
        {showsProgress && <p className="text-xs text-gray-400 mb-3">{c.home.producedNote}</p>}
        <ul className="space-y-3">
          {cards.map((card) => {
            const progress = progressOf(card);
            return (
            <li key={card.key} className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5">
              <p className="text-lg font-semibold text-gray-900 break-words">{card.product}</p>

              {/* The quantity AS THEY ASKED FOR IT, with the kilograms small
                  underneath — never the other way round, and never a computed
                  piece count when Master has no weight to compute it from. */}
              {card.qtyAsked > 0 || card.qtyPieces !== null || card.qtyKg > 0 ? (
                <p className="text-sm text-gray-700 mt-1">
                  {card.qtyAsked > 0
                    ? `${c.home.askedFor}: ${fmtNum(card.qtyAsked, isAr)} ${unitLabel(card.unit)}`
                    : card.qtyPieces !== null
                    ? `${c.home.askedFor}: ${fmtNum(card.qtyPieces, isAr)} ${c.units.pieces}`
                    : `${c.home.askedFor}: ${fmtNum(card.qtyKg, isAr)} ${c.units.kg}`}
                </p>
              ) : (
                // No kilograms and no piece count on the order row (2026-10-05):
                // said in words, quietly, instead of the empty line it used to
                // leave. Nothing is parsed out of the order's notes.
                <p className="text-sm text-gray-400 mt-1">{c.home.qtyPending}</p>
              )}
              {card.unit === UNIT_PIECES && card.qtyKg > 0 && (
                <p className="text-xs text-gray-400">{fill(c.home.approxKg, { kg: fmtNum(card.qtyKg, isAr) })}</p>
              )}

              {/* «تم إنتاج» — the count made for THIS order (see the header).
                  Nothing when the server sent no number; the grey sentence
                  when the order is running and no shift is credited yet. */}
              {progress.kind === "empty" && (
                <p className="text-sm text-gray-400 mt-2">{c.home.producedNone}</p>
              )}
              {progress.kind === "count" && (
                <ProducedLine
                  text={
                    progress.total !== null
                      ? fill(c.home.producedOf, { made: fmtNum(progress.made, isAr), total: fmtNum(progress.total, isAr) })
                      : fill(c.home.producedOnly, { made: fmtNum(progress.made, isAr) })
                  }
                  pct={progress.pct}
                  pctText={progress.pct === null ? "" : fmtPct(progress.pct / 100, isAr)}
                />
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${stepTone[card.step]}`}>
                  {c.home.steps[card.step]}
                </span>
                {card.stepDate && (
                  <span className="text-xs text-gray-500">
                    <bdi dir="ltr">{fill(c.home.onDate, { date: formatDate(card.stepDate, lang) })}</bdi>
                  </span>
                )}
                {card.jobCode && card.step !== "rejected" && card.step !== "cancelled" && (
                  <span className="text-xs text-gray-500">
                    <bdi dir="ltr">{fill(c.home.orderNo, { code: card.jobCode })}</bdi>
                  </span>
                )}
              </div>

              {card.step === "rejected" && card.rejectReason && (
                <p className="mt-2 text-sm text-red-700">{fill(c.home.rejectedWhy, { reason: card.rejectReason })}</p>
              )}

              {/* The promised date, and the one they asked for beside it when
                  the two differ. Hiding that difference is how a phone call
                  starts. */}
              {card.step !== "rejected" && card.step !== "cancelled" && (
                <p className="mt-2 text-sm text-gray-700">
                  {card.dueDate ? (
                    <bdi dir="ltr">{fill(c.home.due, { date: formatDate(card.dueDate, lang) })}</bdi>
                  ) : (
                    c.home.noDue
                  )}
                  {card.wantedDate && card.dueDate && card.wantedDate !== card.dueDate && (
                    <span className="ms-2 text-xs text-gray-400 line-through">
                      <bdi dir="ltr">{fill(c.home.dueAsked, { date: formatDate(card.wantedDate, lang) })}</bdi>
                    </span>
                  )}
                </p>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <a
                  href={waUrl(card.reqId || card.jobCode)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center min-h-11 sm:min-h-9 px-3 rounded-lg border border-green-600 text-green-700 hover:bg-green-50 active:bg-green-100 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
                >
                  {c.home.whatsapp}
                </a>
                {card.product && (
                  <Link
                    href={`/portal/new?product=${encodeURIComponent(card.product)}&qty=${encodeURIComponent(
                      String(card.qtyAsked > 0 ? card.qtyAsked : card.qtyPieces ?? card.qtyKg ?? ""),
                    )}`}
                    className="inline-flex items-center justify-center min-h-11 sm:min-h-9 px-3 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 active:bg-gray-100 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                  >
                    {c.home.repeat}
                  </Link>
                )}
                {card.canCancel && (
                  <Btn variant="danger" onClick={() => { setCancelErr(""); setCancelling(card); }}>
                    {c.home.cancel}
                  </Btn>
                )}
                {card.reqId && (
                  <span className="text-xs text-gray-400 ms-auto">
                    <bdi dir="ltr">{c.home.ref}: {card.reqId}</bdi>
                  </span>
                )}
              </div>
            </li>
            );
          })}
        </ul>
        </>
      )}

      <Modal
        open={!!cancelling}
        isAr={isAr}
        title={c.home.cancelConfirm}
        onClose={() => { if (!busy) setCancelling(null); }}
      >
        <p className="text-sm text-gray-700 mb-2">{cancelling?.product}</p>
        {cancelling?.reqId && (
          <p className="text-xs text-gray-400 mb-4"><bdi dir="ltr">{c.home.ref}: {cancelling.reqId}</bdi></p>
        )}
        {cancelErr && <p className="text-sm text-red-700 mb-3">{cancelErr}</p>}
        <div className="flex flex-wrap gap-2">
          <Btn onClick={doCancel} disabled={busy} variant="danger">{c.home.cancelGo}</Btn>
          <Btn variant="outline" onClick={() => setCancelling(null)} disabled={busy}>{c.home.cancelKeep}</Btn>
        </div>
      </Modal>
    </div>
  );
}
