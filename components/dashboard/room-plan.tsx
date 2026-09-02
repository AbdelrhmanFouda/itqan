"use client";
/**
 * The storage room, drawn.
 *
 * Lifted out of app/dashboard/storage/page.tsx on 2026-08-30 when the owner sent
 * his own floor plan and said: the boxes are the columns. Keeping it here means
 * the page stays about filtering and this file stays about the room.
 */
import { X } from "lucide-react";
import { Btn } from "@/components/dashboard/ui";
import { NO_LOCATION, type FloorPlan, type LocationStat, type PlanSlot } from "@/lib/storage-filter";

/* -------------------------------- the room -------------------------------- */

/**
 * The floor plan, drawn the way the owner draws it on paper: a box per physical
 * column with its places written on both sides, one stack of boxes per line.
 *
 * `dir="rtl"` is FORCED here whatever the page language — this is a map of a
 * room, not a paragraph. Line A stands to the right of line B in the building,
 * and mirroring the room when somebody switches to English would make the plan
 * lie. Side 1 is likewise the right-hand face of every column, as drawn.
 */
export function RoomPlan({
  plan, active, count, lineLabel, zonesLabel, noLocLabel, onPick,
}: {
  plan: FloorPlan;
  active: string;
  count: (l: LocationStat) => number;
  lineLabel: (line: string) => string;
  zonesLabel: string;
  noLocLabel: string;
  onPick: (key: string) => void;
}) {
  const slot = (ps: PlanSlot) => (
    <SlotBtn key={ps.key} short={ps.short} stat={ps.stat} n={count(ps.stat)} active={active === ps.key} onPick={onPick} />
  );
  return (
    <div dir="rtl">
      {plan.lines.length > 0 && (
        <div className="overflow-x-auto -mx-1 px-1">
          <div className="flex items-start justify-center gap-3 sm:gap-6 min-w-max pb-1">
            {/* far right of the room: «رف», T — where they sit on the drawing */}
            {plan.named.length > 0 && (
              <div className="flex flex-col items-center gap-1.5 pt-5">
                {plan.named.map((n) => (
                  <button
                    key={n.key}
                    onClick={() => onPick(n.key)}
                    aria-pressed={active === n.key}
                    className={`w-10 min-h-20 rounded-lg border px-1 py-2 text-[11px] font-medium leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${chipTone(active === n.key, n.negative, count(n))}`}
                  >
                    <span className="block">{n.label}</span>
                    {count(n) > 0 && <span className="block text-[9px] font-normal opacity-70 tabular-nums">{count(n)}</span>}
                  </button>
                ))}
              </div>
            )}
            {plan.lines.map((l) => (
              <div key={l.line} className="flex flex-col items-center gap-2.5">
                <span className="text-[11px] font-medium text-gray-400">{lineLabel(l.line)}</span>
                {l.pillars.map((p) => (
                  <div key={p.index} className="grid grid-cols-[auto_1.5rem_auto] items-stretch gap-1">
                    <div className="flex flex-col gap-1">{p.side1.map(slot)}</div>
                    {/* the column itself — solid, not somewhere anything can go */}
                    <div className="rounded-md bg-gray-100 border border-gray-300" aria-hidden />
                    <div className="flex flex-col gap-1">{p.side2.map(slot)}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      {(plan.zones.length > 0 || plan.unfiled) && (
        <div className="flex flex-wrap items-center gap-1.5 mt-3">
          <span className="text-[11px] font-medium text-gray-400 w-12 shrink-0">{zonesLabel}</span>
          {plan.zones.map((z) => (
            <LocChip
              key={z.key} label={z.label} count={count(z)} negative={z.negative}
              active={active === z.key} onClick={() => onPick(z.key)}
            />
          ))}
          {plan.unfiled && (
            <LocChip
              label={noLocLabel} count={count(plan.unfiled)} negative={false}
              active={active === NO_LOCATION} onClick={() => onPick(NO_LOCATION)}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** One storage place, on one face of one column. The label is the two-digit code
 *  the paper writes; the line letter is the column header rather than repeated
 *  32 times — but the full code rides on aria-label and the tooltip. */
function SlotBtn({
  short, stat, n, active, onPick,
}: {
  short: string; stat: LocationStat; n: number; active: boolean; onPick: (key: string) => void;
}) {
  return (
    <button
      onClick={() => onPick(stat.key)}
      aria-pressed={active}
      aria-label={`${stat.label} — ${n}`}
      title={stat.label}
      className={`w-10 h-10 shrink-0 rounded-md border flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${chipTone(active, stat.negative, n)}`}
    >
      <span dir="ltr">{short}</span>
      {n > 0 && <span className="text-[9px] font-normal opacity-70 tabular-nums">{n}</span>}
    </button>
  );
}

function chipTone(active: boolean, negative: boolean, count: number): string {
  return active
    ? "border-blue-600 bg-blue-600 text-white"
    : negative
    ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
    : count === 0
    ? "border-dashed border-gray-200 bg-white text-gray-400 hover:bg-gray-50"
    : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50";
}

/* --------------------------------- pieces --------------------------------- */

export function LocChip({
  label, count, negative, active, onClick,
}: {
  label: string; count: number; negative: boolean; active: boolean; onClick: () => void;
}) {
  const tone = chipTone(active, negative, count);
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 min-h-11 sm:min-h-8 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${tone}`}
    >
      <span dir="ltr">{label}</span>
      {count > 0 && <span className="tabular-nums opacity-70">{count}</span>}
    </button>
  );
}

export function FilteredEmpty({ text, label, onClear }: { text: string; label: string; onClear: () => void }) {
  return (
    <div className="bg-white border border-dashed border-gray-200 bg-gray-50/50 rounded-xl p-10 text-center space-y-3">
      <p className="text-sm font-medium text-gray-600">{text}</p>
      <Btn variant="outline" onClick={onClear}><X size={14} /> {label}</Btn>
    </div>
  );
}

