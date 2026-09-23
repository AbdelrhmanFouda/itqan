"use client";
/**
 * «طلب جديد» — four fields, and nothing a person can mistype.
 *
 * The product is PICKED from the customer's own «الرئيسي» rows (the server
 * decides which those are; this screen never sends a company name, because no
 * portal route would read one). The quantity carries the unit the product
 * decides — pieces when Master's weight is readable, kilograms when it is not,
 * which is the only honest choice: a piece count with no weight behind it
 * cannot be turned into material. The date is required and cannot be in the
 * past. The note is optional.
 *
 * NO ERROR STATE IS REACHABLE BY A NORMAL TAP. The send button stays disabled
 * until the form is valid and a grey line says what is still missing, so the
 * only messages a buyer can meet are the ones only the server can know — the
 * five-open cap and a sheet that would not take the row.
 *
 * The receipt is the whole of what v1 promises: a reference number the moment
 * they submit, and «يتم الرد خلال يوم عمل» (owner's decision 16). No delivery
 * date is promised here — that is the factory's to set at approval.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Search } from "lucide-react";
import { useLang } from "@/context/LangContext";
import { usePageTitle } from "@/components/dashboard/use-page-title";
import { cp } from "@/lib/i18n.portal";
import { authedFetch } from "@/lib/authed-fetch";
import { timedJson } from "@/components/dashboard/last-seen";
import { Btn, Field, LoadError, Spinner, inputCls } from "@/components/dashboard/ui";
import { fill, fmtNum } from "@/lib/format";
import { todayIso } from "@/lib/dates";
import { matchesTerms, searchTerms } from "@/lib/storage-filter";
import { ISO_DAY, parseQuantity } from "@/lib/work-orders";
import { qtyKgFor, UNIT_PIECES, NOTE_MAX } from "@/lib/customer-requests";

type Product = { name: string; masterRow: number; unit: string; pieceWeightG: number };
type ProductsData = { ok: boolean; products: Product[] };

/** Enough to scroll with a thumb; the search narrows the rest. */
const LIST_MAX = 50;

export default function NewRequestPage() {
  const { lang } = useLang();
  const c = cp[lang];
  const isAr = lang === "ar";
  usePageTitle(c.neu.title);
  const router = useRouter();
  const today = todayIso();

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const [picked, setPicked] = useState<Product | null>(null);
  const [q, setQ] = useState("");
  const [qty, setQty] = useState("");
  const [wantedDate, setWantedDate] = useState("");
  const [note, setNote] = useState("");

  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState("");
  const [receipt, setReceipt] = useState("");

  /** «اطلب زيّه تاني» — the query the card links to. Read from the URL rather
   *  than through useSearchParams so this page needs no Suspense boundary. */
  const [prefill, setPrefill] = useState<{ product: string; qty: string } | null>(null);
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const product = p.get("product") ?? "";
      if (product) setPrefill({ product, qty: p.get("qty") ?? "" });
    } catch {
      /* no query, nothing to prefill */
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await timedJson<ProductsData>(authedFetch, "/api/portal/products");
    setLoading(false);
    if (!r.ok || !r.data?.ok) { setLoadFailed(true); return; }
    setLoadFailed(false);
    setProducts(Array.isArray(r.data.products) ? r.data.products : []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Prefill once the list is in — the product has to exist under this account
  // for the request to be legal, so a stale link simply picks nothing.
  useEffect(() => {
    if (!prefill || picked || products.length === 0) return;
    const hit = products.find((p) => p.name === prefill.product);
    if (!hit) return;
    setPicked(hit);
    const n = parseQuantity(prefill.qty);
    if (n.value !== null && n.value > 0) setQty(String(n.value));
    setPrefill(null);
  }, [prefill, picked, products]);

  const terms = useMemo(() => searchTerms(q), [q]);
  const matched = useMemo(
    () => (terms.length ? products.filter((p) => matchesTerms([p.name], terms)) : products),
    [products, terms],
  );
  const hits = matched.slice(0, LIST_MAX);
  const more = matched.length - hits.length;

  const parsed = parseQuantity(qty);
  const qtyOk = parsed.value !== null && parsed.value > 0;
  const dateOk = ISO_DAY.test(wantedDate) && wantedDate >= today;
  const ready = !!picked && qtyOk && dateOk;
  const hint = !picked ? c.neu.needProduct : !qtyOk ? c.neu.needQty : !dateOk ? c.neu.needDate : "";

  const approxKg =
    picked && picked.unit === UNIT_PIECES && qtyOk
      ? qtyKgFor(parsed.value as number, picked.unit, picked.pieceWeightG)
      : 0;

  const submit = useCallback(async () => {
    if (!picked || !ready || sending) return;
    setSending(true);
    setSendErr("");
    try {
      const res = await authedFetch("/api/portal/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product: picked.name,
          masterRow: picked.masterRow,
          qtyAsked: parsed.value,
          wantedDate,
          note,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; reqId?: string; reason?: string };
      if (!res.ok || !json.ok) {
        setSendErr(json.reason === "too_many_open" ? c.neu.tooMany : c.neu.failed);
        return;
      }
      setReceipt(json.reqId ?? "");
    } catch {
      setSendErr(c.neu.failed);
    } finally {
      setSending(false);
    }
  }, [picked, ready, sending, parsed.value, wantedDate, note, c.neu.failed, c.neu.tooMany]);

  /* -------------------------------- receipt -------------------------------- */

  if (receipt) {
    return (
      <div className="max-w-lg mx-auto" dir={isAr ? "rtl" : "ltr"}>
        <div className="bg-white border border-emerald-200 rounded-2xl p-6 text-center">
          <span className="mx-auto mb-3 w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 inline-flex items-center justify-center">
            <Check size={24} />
          </span>
          <h1 className="text-xl font-bold text-gray-900">{c.neu.receiptTitle}</h1>
          <p className="mt-2 text-base font-semibold text-gray-900">
            <bdi dir="ltr">{fill(c.neu.receiptRef, { ref: receipt })}</bdi>
          </p>
          <p className="mt-2 text-sm text-gray-600">{c.neu.receiptReply}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Btn onClick={() => router.push("/portal")}>{c.neu.receiptBack}</Btn>
            <Btn
              variant="outline"
              onClick={() => {
                setReceipt("");
                setPicked(null);
                setQty("");
                setWantedDate("");
                setNote("");
                setQ("");
              }}
            >
              {c.neu.receiptAnother}
            </Btn>
          </div>
        </div>
      </div>
    );
  }

  /* --------------------------------- form ---------------------------------- */

  return (
    <div className="max-w-lg mx-auto" dir={isAr ? "rtl" : "ltr"}>
      <Link href="/portal" className="text-sm text-gray-500 hover:text-gray-900 inline-flex items-center min-h-11">
        {c.neu.back}
      </Link>
      <h1 className="text-2xl font-bold text-gray-900 mt-1 mb-5">{c.neu.title}</h1>

      <form
        noValidate
        onSubmit={(e) => { e.preventDefault(); void submit(); }}
        className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5"
      >
        {/* 1 — the product */}
        <p className="block text-xs font-medium text-gray-600 mb-1">{c.neu.product}</p>
        {picked ? (
          <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-3 flex items-start justify-between gap-3">
            <p className="font-semibold text-gray-900 break-words min-w-0">{picked.name}</p>
            <button
              type="button"
              onClick={() => { setPicked(null); setQ(""); }}
              className="shrink-0 inline-flex items-center min-h-11 sm:min-h-9 px-3 rounded-lg border border-gray-300 bg-white text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            >
              {c.neu.change}
            </button>
          </div>
        ) : loadFailed ? (
          <LoadError
            variant="banner"
            text={c.neu.loadFailed}
            retry={c.common.retry}
            onRetry={() => void load()}
            loading={loading}
          />
        ) : loading ? (
          <Spinner text={c.common.loading} />
        ) : products.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/50 p-5 text-center">
            <p className="text-sm font-medium text-gray-600">{c.neu.noProducts}</p>
            <p className="text-xs text-gray-400 mt-1">{c.neu.noProductsSub}</p>
          </div>
        ) : (
          <>
            <label className="relative block">
              <Search size={15} className="absolute top-1/2 -translate-y-1/2 start-3 text-gray-400 pointer-events-none" />
              <input
                className="w-full border border-gray-300 rounded-lg ps-9 pe-3 py-2 min-h-11 sm:min-h-0 text-base sm:text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                placeholder={c.neu.searchProduct}
                aria-label={c.neu.searchProduct}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                // The box sits inside a <form>: Enter on a phone keyboard
                // would submit it. Here it only picks when one product is left.
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  if (hits.length === 1) setPicked(hits[0]);
                }}
                enterKeyHint="search"
                autoComplete="off"
              />
            </label>
            <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100 bg-white">
              {hits.length === 0 ? (
                <p className="px-3 py-3 text-sm text-gray-500">{c.neu.noMatch}</p>
              ) : (
                <>
                  {hits.map((p) => (
                    <button
                      key={`${p.masterRow}:${p.name}`}
                      type="button"
                      onClick={() => setPicked(p)}
                      className="w-full text-start px-3 py-2.5 min-h-11 hover:bg-blue-50 active:bg-blue-100 focus-visible:outline-none focus-visible:bg-blue-50"
                    >
                      <span className="block text-sm font-medium text-gray-900 break-words">{p.name}</span>
                    </button>
                  ))}
                  {more > 0 && <p className="px-3 py-2.5 text-xs text-gray-500">{fill(c.neu.more, { n: more })}</p>}
                </>
              )}
            </div>
          </>
        )}

        {/* 2 — the quantity, in the unit the product decides */}
        <div className="mt-4">
          <Field label={picked && picked.unit !== UNIT_PIECES ? c.neu.quantityKg : c.neu.quantityPieces}>
            <input
              className={inputCls}
              inputMode="decimal"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              disabled={!picked}
              autoComplete="off"
            />
          </Field>
          {approxKg > 0 && (
            <p className="-mt-2 mb-3 text-xs text-gray-500">{fill(c.neu.approx, { kg: fmtNum(approxKg, isAr) })}</p>
          )}
        </div>

        {/* 3 — the date they need it */}
        <Field label={c.neu.wantedDate}>
          <input
            type="date"
            className={inputCls}
            value={wantedDate}
            min={today}
            onChange={(e) => setWantedDate(e.target.value)}
          />
        </Field>

        {/* 4 — anything else */}
        <Field label={c.neu.note}>
          <textarea
            className={inputCls}
            rows={3}
            maxLength={NOTE_MAX}
            placeholder={c.neu.notePlaceholder}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

        {sendErr && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{sendErr}</p>}
        {!sendErr && hint && <p className="text-xs text-gray-500 mb-3">{hint}</p>}

        <Btn type="submit" disabled={!ready || sending} className="w-full">
          {sending ? c.neu.sending : c.neu.submit}
        </Btn>
      </form>
    </div>
  );
}
