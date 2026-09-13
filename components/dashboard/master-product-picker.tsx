"use client";
/**
 * Picking a product from «الرئيسي» — the only way the jobs pages take one
 * (2026-09-13, owner: "choose the product from the master and all the data
 * that is in the master sheet to be from the master and no need to write it
 * again"). A search box over Master's names, clients and mould numbers, a
 * short list to tap, and once a product is picked a card with what Master
 * holds for it. There is nothing to mistype, so there is no "not in Master"
 * message to show anyone.
 *
 * Every Master ROW is listed, not every name: a name Master holds twice (two
 * customers' «غطاء احمر جديد») shows twice, told apart by client and mould
 * number, and the caller sends the picked row so the server takes that row's
 * client — not the first twin's (lib/master-lookup.ts masterRowForPick).
 */
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useLang } from "@/context/LangContext";
import { pd } from "@/lib/i18n.prod";
import { nameKey } from "@/lib/master-lookup";
import { fill } from "@/lib/format";
import { matchesTerms, searchTerms } from "@/lib/storage-filter";

/** The Master fields a picked product carries — a subset of /api/molds' MoldRow. */
export type MasterPick = {
  row: number; name: string; client: string; number: string;
  weight: string; material: string; cavities: string; machine: string;
};

/** Enough to scroll with a thumb; the search narrows the rest, and the list says how many more. */
const LIST_MAX = 50;

/** Master rows that name a product, each distinct name + client + mould number once. */
export function pickableProducts<T extends MasterPick>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    const k = nameKey(r.name);
    if (!k) continue;
    const id = `${k}|${nameKey(r.client)}|${nameKey(r.number)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(r);
  }
  return out;
}

/** The first Master row for a product name (whitespace/digit-folded), or null. */
export function findProduct<T extends { name: string }>(rows: readonly T[], name: string | undefined | null): T | null {
  const k = nameKey(name);
  return k ? rows.find((r) => nameKey(r.name) === k) ?? null : null;
}

/** The first number in Master's free-text weight («14جم للقطعه» → 14), 0 when none. */
export function pieceGrams(weight: string | undefined | null): number {
  const m = String(weight ?? "").match(/[0-9]+(?:\.[0-9]+)?/);
  return m ? Number(m[0]) : 0;
}

export function MasterProductPicker({ rows, value, onChange, loading, failed, onRetry }: {
  rows: readonly MasterPick[];
  value: MasterPick | null;
  onChange: (m: MasterPick | null) => void;
  /** Master is still on its way — say "loading", not "no product". */
  loading?: boolean;
  /** Master could not be read — say so and offer to ask again. */
  failed?: boolean;
  onRetry?: () => void;
}) {
  const { lang } = useLang();
  const t = pd[lang];
  const [q, setQ] = useState("");
  const products = useMemo(() => pickableProducts(rows), [rows]);
  const terms = useMemo(() => searchTerms(q), [q]);
  const matched = useMemo(
    () => (terms.length ? products.filter((m) => matchesTerms([m.name, m.client, m.number], terms)) : products),
    [products, terms],
  );
  const hits = matched.slice(0, LIST_MAX);
  const more = matched.length - hits.length;
  const sub = (m: MasterPick) => [m.client, m.number ? `${t.jobs.moldNumber} ${m.number}` : ""].filter(Boolean).join(" · ");

  if (value) {
    const g = pieceGrams(value.weight);
    const facts: [string, string][] = [];
    if (value.material) facts.push([t.jobs.materialType, value.material]);
    if (g > 0) facts.push([t.jobs.partWeight, String(g)]);
    if (value.cavities) facts.push([t.jobs.cavities, value.cavities]);
    return (
      <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 break-words">{value.name}</p>
            {sub(value) && <p className="text-xs text-gray-600 mt-0.5">{sub(value)}</p>}
          </div>
          <button
            type="button"
            onClick={() => { setQ(""); onChange(null); }}
            className="shrink-0 inline-flex items-center min-h-11 sm:min-h-9 px-3 rounded-lg border border-gray-300 bg-white text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          >
            {t.jobs.changeProduct}
          </button>
        </div>
        {facts.length > 0 && (
          <dl className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs">
            {facts.map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-gray-500">{k}</dt>
                <dd className="text-gray-900 font-medium break-words">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="text-[11px] text-gray-400 mt-2">{t.jobs.fromMaster}</p>
      </div>
    );
  }

  return (
    <div>
      <label className="relative block">
        <Search size={15} className="absolute top-1/2 -translate-y-1/2 start-3 text-gray-400 pointer-events-none" />
        <input
          className="w-full border border-gray-300 rounded-lg ps-9 pe-3 py-2 min-h-11 sm:min-h-0 text-base sm:text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
          placeholder={t.jobs.searchProduct}
          aria-label={t.jobs.searchProduct}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          // The box sits inside a <form>: Enter/«Go» on a phone keyboard would
          // submit it. Here it only picks the product when one is left.
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (hits.length === 1) onChange(hits[0]);
          }}
          enterKeyHint="search"
          autoComplete="off"
          autoFocus
        />
      </label>
      <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100 bg-white">
        {rows.length === 0 ? (
          failed ? (
            <div className="px-3 py-3 flex flex-wrap items-center gap-3 text-sm text-gray-600">
              <span>{t.jobs.masterLoadFailed}</span>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="inline-flex items-center min-h-11 sm:min-h-9 px-3 rounded-lg border border-gray-300 bg-white text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                >
                  {t.common.retry}
                </button>
              )}
            </div>
          ) : (
            <p className="px-3 py-3 text-sm text-gray-500">{loading ? t.common.loading : t.jobs.noProductMatch}</p>
          )
        ) : hits.length === 0 ? (
          <p className="px-3 py-3 text-sm text-gray-500">{t.jobs.noProductMatch}</p>
        ) : (
          <>
            {hits.map((m) => (
              <button
                key={m.row}
                type="button"
                onClick={() => onChange(m)}
                className="w-full text-start px-3 py-2.5 min-h-11 hover:bg-blue-50 active:bg-blue-100 focus-visible:outline-none focus-visible:bg-blue-50"
              >
                <span className="block text-sm font-medium text-gray-900 break-words">{m.name}</span>
                {sub(m) && <span className="block text-xs text-gray-500">{sub(m)}</span>}
              </button>
            ))}
            {more > 0 && <p className="px-3 py-2.5 text-xs text-gray-500">{fill(t.jobs.moreProducts, { n: more })}</p>}
          </>
        )}
      </div>
    </div>
  );
}
