/**
 * «المخزون» as the customer reads it — PROP-DRIVEN, no fetching, so it renders
 * the same from the live answer, the device snapshot, or a fixture.
 *
 * One card per item. The name is the largest thing on it; the balance is the
 * figure; under it, small and grey, the kilograms when the item is counted in
 * pieces and a weight can be derived («≈» when that weight came from a piece
 * weight rather than a scale). Then one quiet row — what came in and what went
 * out — and the two last dates when the sheet has them.
 *
 * What is deliberately NOT here:
 *  - a total across items. Pieces of one product and pieces of another do not
 *    add up to anything a person can use;
 *  - a number on a line under review. The server sends none (`qty`, `kg`,
 *    `received` and `issued` are null) and the card says «تحت المراجعة»;
 *  - a zero standing in for "unknown". A weight nobody can derive is absent,
 *    and a quantity that cannot be stated is «غير مسجَّل».
 *
 * Every number goes through lib/format.ts (Latin digits in both languages).
 */
import { EmptyState } from "@/components/dashboard/ui";
import { cp } from "@/lib/i18n.portal";
import { WHATSAPP_URL } from "@/lib/company";
import { fill, fmtNum } from "@/lib/format";
import { formatDateWithYear } from "@/lib/dates";
import type { Lang } from "@/lib/i18n";
import type { PortalStockKind, PortalStockLine } from "@/lib/customer-stock";

type Strings = (typeof cp)[Lang];

const GROUPS: PortalStockKind[] = ["product", "material", "other"];

/** Lines with stock (or a question over them) first, then the empty ones; by name inside each. */
function ordered(lines: readonly PortalStockLine[]): PortalStockLine[] {
  const quiet = (l: PortalStockLine) => (!l.review && l.qty === 0 ? 1 : 0);
  return [...lines].sort((a, b) => quiet(a) - quiet(b) || a.item.localeCompare(b.item, "ar"));
}

export function StockView({ lines, lang }: { lines: readonly PortalStockLine[]; lang: Lang }) {
  const isAr = lang === "ar";
  const c = cp[lang];

  if (lines.length === 0) {
    return (
      <div className="space-y-4" dir={isAr ? "rtl" : "ltr"}>
        <EmptyState text={c.stock.empty} />
        <a
          href={WHATSAPP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full bg-green-600 hover:bg-green-700 active:bg-green-800 text-white text-sm px-5 py-2 min-h-11 inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
        >
          {c.common.whatsapp}
        </a>
      </div>
    );
  }

  const title: Record<PortalStockKind, string> = {
    product: c.stock.products, material: c.stock.materials, other: c.stock.other,
  };

  return (
    <div className="space-y-7" dir={isAr ? "rtl" : "ltr"}>
      {GROUPS.map((kind) => {
        const group = ordered(lines.filter((l) => l.kind === kind));
        if (group.length === 0) return null;
        return (
          <section key={kind} aria-label={title[kind]}>
            <h2 className="flex items-center gap-2 mb-3 text-sm font-semibold text-gray-700">
              {title[kind]}
              <span className="rounded-full bg-gray-200/70 px-2 py-0.5 text-xs font-medium text-gray-600 tabular-nums">
                {fmtNum(group.length, isAr)}
              </span>
            </h2>
            <ul className="space-y-3">
              {group.map((line) => (
                <StockCard key={`${line.kind}:${line.item}:${line.unit}`} line={line} c={c} isAr={isAr} lang={lang} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function StockCard({ line, c, isAr, lang }: { line: PortalStockLine; c: Strings; isAr: boolean; lang: Lang }) {
  const num = (n: number) => fmtNum(n, isAr, 2);
  // An ESTIMATE (pieces × piece weight) must not read like a scale reading:
  // whole kilograms from 100 up, one decimal below. A weighed figure keeps `num`.
  const est = (kg: number) => fmtNum(kg >= 100 ? Math.round(kg) : Math.round(kg * 10) / 10, isAr, 1);
  const unit = line.unit === "pcs" ? c.units.pieces : line.unit === "kg" ? c.units.kg : line.unit;
  const zero = !line.review && line.qty === 0;

  if (line.review) {
    return (
      <li className="bg-white border border-amber-200 rounded-2xl p-4 sm:p-5">
        <p className="text-xl font-semibold text-gray-900 break-words"><bdi>{line.item}</bdi></p>
        <span className="mt-2 inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
          {c.stock.review}
        </span>
        <p className="mt-2 text-sm text-gray-600">{c.stock.reviewBody}</p>
      </li>
    );
  }

  // The kilograms ride under a PIECE count only — a kg line already says them.
  const kgLine =
    line.unit === "pcs" && line.kg !== null && line.kg > 0
      ? fill(line.kgApprox ? c.stock.approxKg : c.stock.exactKg, { kg: line.kgApprox ? est(line.kg) : num(line.kg) })
      : "";
  const flow =
    line.received !== null || line.issued !== null
      ? fill(c.stock.flow, {
          in: line.received !== null ? num(line.received) : "—",
          out: line.issued !== null ? num(line.issued) : "—",
        })
      : "";
  const dates = [
    // with the year when it is not this year's — a stock line can sit untouched for months
    line.lastIn ? fill(c.stock.lastIn, { date: formatDateWithYear(line.lastIn, lang) }) : "",
    line.lastOut ? fill(c.stock.lastOut, { date: formatDateWithYear(line.lastOut, lang) }) : "",
  ].filter(Boolean).join(" · ");

  return (
    <li className={`border rounded-2xl p-4 sm:p-5 ${zero ? "bg-gray-50 border-gray-200/70" : "bg-white border-gray-200"}`}>
      {/* <bdi>: a sheet name mixes Arabic and Latin («PC …»); its word order must not follow the page's direction */}
      <p className={`text-xl font-semibold break-words ${zero ? "text-gray-500" : "text-gray-900"}`}><bdi>{line.item}</bdi></p>

      <p className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className="text-xs text-gray-500">{c.stock.balance}</span>
        {line.qty === null ? (
          <span className="text-sm text-gray-400">{c.stock.unknown}</span>
        ) : (
          <>
            <span className={`text-lg font-bold tabular-nums ${zero ? "text-gray-400" : "text-gray-900"}`}>
              {/* a kg figure rebuilt from piece weights is itself approximate */}
              {line.unit === "kg" && line.kgApprox ? `≈ ${est(line.qty)}` : num(line.qty)}
            </span>
            {unit && <span className={`text-sm ${zero ? "text-gray-400" : "text-gray-600"}`}>{unit}</span>}
          </>
        )}
      </p>
      {kgLine && <p className="text-xs text-gray-400 tabular-nums">{kgLine}</p>}

      {flow && <p className={`mt-2 text-sm tabular-nums ${zero ? "text-gray-400" : "text-gray-500"}`}>{flow}</p>}
      {dates && <p className="mt-0.5 text-xs text-gray-400">{dates}</p>}
    </li>
  );
}
