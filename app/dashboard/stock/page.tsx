"use client";
import { usePageTitle } from "@/components/dashboard/use-page-title";
/**
 * «المتاح في المخزن» — the warehouse as the PRODUCTION side reads it
 * (2026-09-09 brief). One question: can I promise this?
 *
 *   المتوفر   «الكمية المتوفرة», straight from «الرصيد الحالي»
 *   المحجوز   Σ «الكمية المطلوبة» on OPEN work orders for that product
 *   المتاح    المتوفر − المحجوز — the prominent one
 *
 * READ-ONLY. There is no button on this page that writes anywhere; movements
 * stay the storekeeper's (/dashboard/storage). The rules — what counts as
 * open, how kilograms become pieces, and when two numbers must NOT be added
 * («الوحدة مختلفة») — live in lib/stock.ts and are unit-tested; this file only
 * filters and draws. Default order: المتاح ascending, so what is nearly gone
 * is at the top.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "@/context/LangContext";
import { authedFetch } from "@/lib/authed-fetch";
import { st } from "@/lib/i18n.stock";
import { pd } from "@/lib/i18n.prod";
import { JOB_STATUSES, jobTone, localize } from "@/lib/prod-meta";
import { matchesTerms, searchTerms } from "@/lib/storage-filter";
import { compareByNet, isMaterialType, type StockRow } from "@/lib/stock";
import { codeKey } from "@/lib/work-orders";
import { ageLabel, fill, numLocale } from "@/lib/format";
import { timedJson } from "@/components/dashboard/last-seen";
import { useRemembered } from "@/components/dashboard/use-remembered";
import { EmptyState, Pill, Spinner, LoadError, StatTile, iconBtnCls, filterCls } from "@/components/dashboard/ui";
import { ChevronDown, ChevronRight, Lock, MapPin, RefreshCw, Search, SlidersHorizontal, X } from "lucide-react";

type Resp = {
  ok: boolean; configured: boolean; jobsOk: boolean; rows: StockRow[];
  meta: {
    catalog: boolean; catalogRows: number; asOf: string;
    dataAgeMs: number; storageAgeMs: number; storageStale: boolean;
  };
};
const LAST_KEY = "itqan.stock.last";
/** Past this the page says «الأرقام من قبل …» and refetches once on its own. */
const STALE_AFTER_MS = 60_000;
type Tile = "" | "negative" | "belowMin" | "unit" | "withOrders";
type TypeFilter = "" | "منتج" | "خامة";
type Sort = "net" | "item" | "available";


export default function StockPage() {
  const { lang } = useLang();
  const isAr = lang === "ar";
  const s = st[lang];
  const p = pd[lang];
  usePageTitle(s.title);
  const fmtN = useCallback((n: number) => n.toLocaleString(numLocale(isAr), { maximumFractionDigits: 2 }), [isAr]);

  const [search, setSearch] = useState("");
  const [type, setType] = useState<TypeFilter>("");
  const [tile, setTile] = useState<Tile>("");
  const [sort, setSort] = useState<Sort>("net");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const loadRef = useRef<() => Promise<void>>(async () => {});
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const staleRefetches = useRef(0);
  const { data, loading, failed: error, reload: load } = useRemembered<Resp>({
    key: LAST_KEY,
    read: () => timedJson<Resp>(authedFetch, "/api/stock"),
    valid: (snap) => Array.isArray(snap?.rows) && !!snap.meta,
    // A snapshot's age is unknown — the spinner is its honest hint.
    hydrate: (snap) => ({ ...snap, meta: { ...snap.meta, dataAgeMs: 0, storageAgeMs: 0, storageStale: false } }),
    // The storage bridge answers with nothing when throttled (measured: a 17 s
    // read returning ok:false minutes after a 5 s one returned 151 rows). A
    // refresh that fails must not blank a page that was showing the balance a
    // moment ago — keep the rows, show the notice.
    merge: (prev, next) => (!next.ok && prev && prev.rows.length > 0 ? { ...prev, ok: false, meta: next.meta } : next),
    worthRemembering: (next) => next.ok,
    onLoaded: (next) => {
      // An old copy was served (and is being refreshed server-side): ask once
      // more in a few seconds. Bounded — a bridge that stays down must not
      // turn this into a poll.
      const age = Math.max(next.meta?.dataAgeMs ?? 0, next.meta?.storageAgeMs ?? 0);
      if (age <= STALE_AFTER_MS) staleRefetches.current = 0;
      else if (!refetchTimer.current && staleRefetches.current < 2) {
        staleRefetches.current += 1;
        refetchTimer.current = setTimeout(() => { refetchTimer.current = null; loadRef.current(); }, 8000);
      }
    },
  });
  loadRef.current = load;
  useEffect(() => () => { if (refetchTimer.current) clearTimeout(refetchTimer.current); }, []);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const hasMin = !!data?.meta.catalog;
  const counts = useMemo(() => ({
    rows: rows.length,
    negative: rows.filter((r) => r.net !== null && r.net < 0).length,
    belowMin: rows.filter((r) => r.belowMin).length,
    unit: rows.filter((r) => r.reservedNote === "unit" || r.reservedNote === "unknown").length,
    withOrders: rows.filter((r) => r.orders.length > 0).length,
  }), [rows]);

  const terms = useMemo(() => searchTerms(search), [search]);
  const shown = useMemo(() => {
    let list = rows;
    if (type) list = list.filter((r) => (type === "خامة") === isMaterialType(r.itemType));
    if (tile === "negative") list = list.filter((r) => r.net !== null && r.net < 0);
    if (tile === "belowMin") list = list.filter((r) => r.belowMin);
    if (tile === "unit") list = list.filter((r) => r.reservedNote === "unit" || r.reservedNote === "unknown");
    if (tile === "withOrders") list = list.filter((r) => r.orders.length > 0);
    if (terms.length) list = list.filter((r) => matchesTerms([r.item, r.itemType, ...r.clients, ...r.locs], terms));
    const sorted = [...list];
    if (sort === "item") sorted.sort((a, b) => a.item.localeCompare(b.item, "ar"));
    else if (sort === "available") sorted.sort((a, b) => (a.available ?? Infinity) - (b.available ?? Infinity) || a.item.localeCompare(b.item, "ar"));
    else sorted.sort(compareByNet);
    return sorted;
  }, [rows, type, tile, terms, sort]);

  const filtered = !!(type || tile || terms.length);
  function clearFilters() { setSearch(""); setType(""); setTile(""); setSort("net"); }

  /* ------------------------------ cell helpers ------------------------------ */

  const unitOf = (r: StockRow) => r.unit || "";
  const qty = (n: number | null, r: StockRow) => (n === null ? "—" : `${fmtN(n)} ${unitOf(r)}`);
  const netTone = (r: StockRow) =>
    r.net === null ? "text-gray-400" : r.net < 0 || r.belowMin ? "text-red-600" : r.net === 0 ? "text-gray-500" : "text-emerald-700";
  const reservedCell = (r: StockRow) => {
    if (r.reservedNote === "ok") return <span className="tabular-nums">{fmtN(r.reserved ?? 0)} {unitOf(r)}</span>;
    if (r.reservedNote === "none") return <span className="text-gray-400 tabular-nums">0 {unitOf(r)}</span>;
    if (r.reservedNote === "material") return <span className="text-gray-400" title={s.legend.material}>—</span>;
    // unit / unknown: never a number in this row's unit — the kg on their own
    return (
      <span className="inline-flex flex-col items-end">
        <span className="text-xs font-medium text-amber-700 whitespace-nowrap">{s.reservedNote[r.reservedNote]}</span>
        {r.reservedKg > 0 && <span className="text-[11px] text-gray-500 tabular-nums whitespace-nowrap">{fill(s.reservedKg, { kg: fmtN(r.reservedKg) })}</span>}
      </span>
    );
  };
  const netCell = (r: StockRow, big = false) => (
    <span className={`font-bold tabular-nums ${big ? "text-lg" : ""} ${netTone(r)}`}>
      {r.net === null ? <span title={s.reservedNote[r.reservedNote]}>—</span> : `${fmtN(r.net)} ${unitOf(r)}`}
    </span>
  );
  const minCell = (r: StockRow) =>
    r.min === null
      ? <span className="text-gray-300">—</span>
      : <span className={`tabular-nums ${r.belowMin ? "text-red-600 font-medium" : "text-gray-500"}`}>{fmtN(r.min)} {unitOf(r)}</span>;
  const place = (loc: string) => loc
    ? <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-1.5 py-0.5 text-gray-700 text-xs" dir="ltr"><MapPin size={11} />{loc}</span>
    : <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-amber-700 text-xs"><MapPin size={11} />{s.noLocation}</span>;

  /* --------------------------------- states --------------------------------- */

  if (error && !data) {
    return (
      <div dir={isAr ? "rtl" : "ltr"}>
        <h1 className="text-2xl font-bold text-gray-900 mb-4">{s.title}</h1>
        <LoadError
          variant="empty"
          text={error.timedOut ? p.common.timedOut : s.loadError}
          retry={p.common.retry}
          onRetry={load}
          loading={loading}
        />
      </div>
    );
  }
  if (!data) return <div className="flex justify-center py-16"><Spinner text={p.common.loading} /></div>;
  const dataAge = Math.max(data.meta?.dataAgeMs ?? 0, data.meta?.storageAgeMs ?? 0);
  if (!data.configured) {
    return (
      <div dir={isAr ? "rtl" : "ltr"}>
        <h1 className="text-2xl font-bold text-gray-900 mb-4">{s.title}</h1>
        <EmptyState text={s.notConnected} />
      </div>
    );
  }

  const asOf = new Date(data.meta.asOf).toLocaleTimeString(numLocale(isAr), { hour: "2-digit", minute: "2-digit" });

  return (
    <div dir={isAr ? "rtl" : "ltr"}>
      <div className="mb-5 sm:mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-gray-900">{s.title}</h1>
          <button onClick={load} className={iconBtnCls} title={s.refresh} aria-label={s.refresh} disabled={loading}>
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} /><span className="hidden sm:inline">{s.refresh}</span>
          </button>
        </div>
        <p className="text-sm text-gray-500 mt-1">{s.subtitle}</p>
        <p className="text-xs text-gray-500 mt-2 inline-flex items-start gap-1.5 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5">
          <Lock size={12} className="mt-0.5 shrink-0" />{s.readOnly}
        </p>
      </div>

      {error && (
        <LoadError
          className="mb-3"
          text={error.timedOut ? p.common.timedOut : s.loadError}
          retry={p.common.retry}
          onRetry={load}
          loading={loading}
        />
      )}
      {!data.ok && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">{s.storageDown}</p>}
      {data.ok && data.meta?.storageStale && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
          {fill(s.storageStale, { age: ageLabel(data.meta.storageAgeMs, isAr) })}
        </p>
      )}
      {!data.jobsOk && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">{s.jobsDown}</p>}
      {data.ok && !data.meta?.storageStale && dataAge > STALE_AFTER_MS && (
        <p className="text-xs text-amber-700 mb-3">{fill(s.dataAge, { age: ageLabel(dataAge, isAr) })}</p>
      )}

      {/* tiles — each one filters */}
      <div className={`grid grid-cols-2 ${hasMin ? "sm:grid-cols-5" : "sm:grid-cols-4"} gap-2 sm:gap-3 mb-1`}>
        <StatTile label={s.tiles.rows} value={String(counts.rows)} active={tile === ""} onClick={() => setTile("")} />
        <StatTile label={s.tiles.negative} value={String(counts.negative)} tone={counts.negative ? "red" : undefined} active={tile === "negative"} onClick={() => setTile(tile === "negative" ? "" : "negative")} />
        {hasMin && (
          <StatTile label={s.tiles.belowMin} value={String(counts.belowMin)} tone={counts.belowMin ? "red" : undefined} active={tile === "belowMin"} onClick={() => setTile(tile === "belowMin" ? "" : "belowMin")} />
        )}
        <StatTile label={s.tiles.unit} value={String(counts.unit)} tone={counts.unit ? "amber" : undefined} active={tile === "unit"} onClick={() => setTile(tile === "unit" ? "" : "unit")} />
        <StatTile label={s.tiles.withOrders} value={String(counts.withOrders)} active={tile === "withOrders"} onClick={() => setTile(tile === "withOrders" ? "" : "withOrders")} />
      </div>
      <p className="text-[11px] text-gray-400 mb-4">{s.tilesHint} · {s.asOf} {asOf}</p>

      {/* search + filters */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <label className="relative flex-1 min-w-[14rem]">
          <Search size={15} className="absolute top-1/2 -translate-y-1/2 start-3 text-gray-400 pointer-events-none" />
          <input
            className="w-full border border-gray-300 rounded-lg ps-9 pe-9 py-2 min-h-11 sm:min-h-0 text-base sm:text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
            placeholder={s.search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={s.search}
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute top-1/2 -translate-y-1/2 end-2 min-w-8 min-h-8 inline-flex items-center justify-center text-gray-400 hover:text-gray-700 rounded" aria-label={p.common.cancel}>
              <X size={14} />
            </button>
          )}
        </label>
        <button
          onClick={() => setFiltersOpen((v) => !v)}
          className={`sm:hidden inline-flex items-center gap-1.5 px-3 min-h-11 rounded-lg border text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
            filtersOpen || type || sort !== "net" ? "border-blue-300 bg-blue-50 text-blue-700" : "border-gray-300 bg-white text-gray-700"
          }`}
          aria-expanded={filtersOpen}
        >
          <SlidersHorizontal size={15} /> {s.filters.toggle}
        </button>
      </div>
      <div className={`${filtersOpen ? "flex" : "hidden sm:flex"} flex-wrap items-center gap-2 mb-3`}>
        <select className={filterCls} value={type} onChange={(e) => setType(e.target.value as TypeFilter)} aria-label={s.filters.type}>
          <option value="">{s.filters.all}</option>
          <option value="منتج">{s.filters.products}</option>
          <option value="خامة">{s.filters.materials}</option>
        </select>
        <select className={filterCls} value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={s.filters.sort}>
          <option value="net">{s.filters.sortNet}</option>
          <option value="available">{s.filters.sortAvailable}</option>
          <option value="item">{s.filters.sortItem}</option>
        </select>
        {filtered && (
          <button onClick={clearFilters} className={iconBtnCls}><X size={14} /> {s.filters.clear}</button>
        )}
        <span className="text-xs text-gray-400 ms-auto">{fill(s.filters.showing, { n: shown.length, total: rows.length })}</span>
      </div>
      <p className="text-[11px] text-gray-400 mb-2">{s.tapRow} · {s.searchHint}</p>

      {rows.length === 0 ? (
        <EmptyState text={s.empty} />
      ) : shown.length === 0 ? (
        <EmptyState text={s.noMatch} />
      ) : (
        <>
          {/* phones: cards */}
          <div className="sm:hidden space-y-2">
            {shown.map((r) => {
              const open = openKey === r.key;
              return (
                <div key={r.key} className="bg-white border border-gray-200 rounded-xl">
                  <button
                    onClick={() => setOpenKey(open ? null : r.key)}
                    aria-expanded={open}
                    className="w-full text-start p-4 hover:bg-gray-50 active:bg-gray-100 transition-colors rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                  >
                    <div className="flex items-center justify-between gap-3 min-w-0 mb-1">
                      <p className="font-medium text-gray-900 min-w-0 truncate">{r.item}</p>
                      <span className="shrink-0 text-xs text-gray-400 whitespace-nowrap">{r.itemType}</span>
                    </div>
                    <div className="flex items-end justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] text-gray-500">{s.cols.net}</p>
                        {netCell(r, true)}
                        {r.belowMin && <p className="text-[11px] text-red-600 font-medium">{s.belowMin}</p>}
                      </div>
                      <div className="text-end text-xs text-gray-500 tabular-nums space-y-0.5">
                        <p>{s.cols.available}: <span className="text-gray-800">{qty(r.available, r)}</span></p>
                        <p>{s.cols.reserved}: {reservedCell(r)}</p>
                        {hasMin && r.min !== null && <p>{s.cols.min}: {minCell(r)}</p>}
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-2 flex flex-wrap items-center gap-1.5">
                      {r.locs.length ? r.locs.map((l) => <span key={l}>{place(l)}</span>) : place("")}
                      {r.clients.length > 0 && <span className="truncate">{r.clients.join(" · ")}</span>}
                    </p>
                  </button>
                  {open && <div className="px-4 pb-4"><RowDetails r={r} s={s} p={p} isAr={isAr} fmtN={fmtN} /></div>}
                </div>
              );
            })}
          </div>

          {/* sm+: table */}
          <div className="hidden sm:block bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/50">
                    {[
                      { h: s.cols.type }, { h: s.cols.item }, { h: s.cols.client }, { h: s.cols.loc },
                      { h: s.cols.available, end: true }, { h: s.cols.reserved, end: true }, { h: s.cols.net, end: true },
                      ...(hasMin ? [{ h: s.cols.min, end: true }] : []),
                    ].map((c) => (
                      <th key={c.h} className={`${c.end ? "text-end" : "text-start"} px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap ${c.h === s.cols.net ? "text-gray-800" : ""}`}>{c.h}</th>
                    ))}
                    <th className="px-2 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {shown.map((r) => {
                    const open = openKey === r.key;
                    const cols = 8 + (hasMin ? 1 : 0);
                    return (
                      <RowPair key={r.key} open={open} cols={cols} details={<RowDetails r={r} s={s} p={p} isAr={isAr} fmtN={fmtN} />}>
                        <tr
                          onClick={() => setOpenKey(open ? null : r.key)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenKey(open ? null : r.key); } }}
                          tabIndex={0}
                          aria-expanded={open}
                          className={`hover:bg-blue-50/40 transition-colors cursor-pointer focus-visible:outline-none focus-visible:bg-blue-50/60 ${open ? "bg-blue-50/30" : ""}`}
                        >
                          <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{r.itemType}</td>
                          <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{r.item}</td>
                          <td className="px-4 py-3 text-gray-600 max-w-[14rem] truncate">{r.clients.join(" · ") || "—"}</td>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                            <span className="inline-flex flex-wrap gap-1">{r.locs.length ? r.locs.map((l) => <span key={l}>{place(l)}</span>) : place("")}</span>
                          </td>
                          <td className="px-4 py-3 text-end tabular-nums text-gray-700 whitespace-nowrap">{qty(r.available, r)}</td>
                          <td className="px-4 py-3 text-end whitespace-nowrap">{reservedCell(r)}</td>
                          <td className="px-4 py-3 text-end whitespace-nowrap bg-gray-50/40">
                            {netCell(r, true)}
                            {r.belowMin && <p className="text-[11px] text-red-600 font-medium">{s.belowMin}</p>}
                          </td>
                          {hasMin && <td className="px-4 py-3 text-end whitespace-nowrap">{minCell(r)}</td>}
                          <td className="px-2 py-3 text-gray-300">{open ? <ChevronDown size={15} /> : <ChevronRight size={15} className="rtl:-scale-x-100" />}</td>
                        </tr>
                      </RowPair>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* how the numbers are made */}
      <details className="mt-5 bg-white border border-gray-200 rounded-xl p-4 text-xs text-gray-600">
        <summary className="cursor-pointer font-medium text-gray-800 min-h-8 flex items-center">{s.legend.title}</summary>
        <ul className="mt-2 space-y-1.5 list-disc ps-5 leading-relaxed">
          <li>{s.legend.available}</li>
          <li>{s.legend.reserved}</li>
          <li>{s.legend.net}</li>
          <li>{s.legend.material}</li>
          <li>{s.legend.unit}</li>
          <li>{s.legend.unknown}</li>
          <li>{hasMin ? fill(s.minSource.catalog, { n: data.meta.catalogRows }) : s.minSource.none}</li>
        </ul>
      </details>
    </div>
  );
}

/* ------------------------------- pieces ---------------------------------- */

/** A table row plus, when open, a second row holding the details. */
function RowPair({ children, open, cols, details }: { children: React.ReactNode; open: boolean; cols: number; details: React.ReactNode }) {
  return (
    <>
      {children}
      {open && (
        <tr className="bg-blue-50/20">
          <td colSpan={cols} className="px-4 pb-4 pt-1">{details}</td>
        </tr>
      )}
    </>
  );
}

function RowDetails({ r, s, p, isAr, fmtN }: {
  r: StockRow;
  s: (typeof st)["en"] | (typeof st)["ar"];
  p: (typeof pd)["en"] | (typeof pd)["ar"];
  isAr: boolean;
  fmtN: (n: number) => string;
}) {
  const place = (loc: string) => loc
    ? <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-1.5 py-0.5 text-gray-700 text-xs" dir="ltr"><MapPin size={11} />{loc}</span>
    : <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-amber-700 text-xs"><MapPin size={11} />{s.noLocation}</span>;
  // Two open orders with the same code reserve TWICE (`Pro/tec 01` on rows
  // 15 and 16 both reserve «كليب شد» today) — say so beside each, the same
  // pill the jobs list shows, so the doubled reservation is not read as fact.
  const codeCount = new Map<string, number>();
  for (const o of r.orders) { const k = codeKey(o.code); if (k) codeCount.set(k, (codeCount.get(k) ?? 0) + 1); }
  return (
    <div className="grid gap-4 sm:grid-cols-2 text-sm" dir={isAr ? "rtl" : "ltr"}>
      <div>
        <p className="text-xs font-medium text-gray-500 mb-1.5">{s.lines}</p>
        <ul className="space-y-1">
          {r.lines.map((l, i) => (
            <li key={i} className="flex items-center justify-between gap-3 bg-white border border-gray-100 rounded-lg px-3 py-2">
              <span className="flex flex-wrap items-center gap-1.5 min-w-0 text-gray-700">{place(l.loc)}<span className="truncate">{l.client || "—"}</span></span>
              <span className={`tabular-nums font-medium whitespace-nowrap ${l.avail < 0 ? "text-red-600" : "text-gray-800"}`}>{fmtN(l.avail)} {l.unit}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="text-xs font-medium text-gray-500 mb-1.5">{s.orders}</p>
        {r.orders.length === 0 ? (
          <p className="text-xs text-gray-400">{s.reservedNote[r.reservedNote === "material" ? "material" : "none"]}</p>
        ) : (
          <ul className="space-y-1">
            {r.orders.map((o) => (
              <li key={o.id} className="bg-white border border-gray-100 rounded-lg px-3 py-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium text-gray-900">{o.code || "—"}</span>
                  <Pill text={localize(o.status, JOB_STATUSES, p.jobs.statuses)} tone={jobTone(o.status)} />
                  {(codeCount.get(codeKey(o.code)) ?? 0) > 1 && <Pill text={p.jobs.duplicateCode} tone="amber" />}
                  <span className="text-xs text-gray-500 truncate">{o.client}</span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5 tabular-nums">
                  {o.qtyUnreadable
                    ? <span className="text-amber-700">{s.order.qty}: {s.order.unreadable}</span>
                    : o.qtyKg === null
                      ? <span className="text-amber-700">{s.order.qty}: —</span>
                      : <>{fmtN(o.qtyKg)} {s.kg}{o.qtyPieces > 0 ? ` ≈ ${fmtN(o.qtyPieces)} ${s.pcs}` : ""}</>}
                  {" · "}
                  {o.dueDate ? `${s.order.due}: ${o.dueDate}` : <span className="text-amber-700">{s.order.noDue}</span>}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** A number that is also a filter. */
