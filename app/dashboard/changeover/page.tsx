"use client";
import { usePageTitle } from "@/components/dashboard/use-page-title";
/**
 * «خطة الاسطمبات» — which mould goes on which machine next (2026-09-30;
 * reworked 2026-10-05 at the owner's word: "show all the machines and what is
 * on them now", "make me able to edit here", "the machines shown on a map").
 *
 * The page opens on the FLOOR: every machine where it stands, with what its
 * latest shift in «الإنتاج» says is on it and whether it is running or
 * standing idle. Tapping a machine shows what is on it — editable there,
 * colours included, because nothing else in the workbook holds them — and the
 * waiting work orders ranked for it, each with its reasons.
 *
 * It suggests; the engineer decides. «ركّب دي» opens a checklist and only its
 * confirm writes: one row in «تغييرات الاسطمبات», the machine on the work
 * order, the product on the machines tab — each outcome said on its own.
 *
 * The rules (what is running, order of priority, colour ladder, minutes, what
 * blocks an order, the map's grid) are in lib/changeover.ts and unit-tested;
 * this file asks, ranks with those functions in the browser, and draws.
 *
 * 2026-10-07 (ten changes the owner approved that day): the day's plan lets
 * the urgent orders choose their machine first and says which of them it
 * could not place; a machine stopped for a repair is listed, never offered a
 * mould; times are hours on the clock (Friday is the day off) and say which
 * day's log they were counted from; the store's stock, where a mould has run
 * before and the machine's own recorded change time are shown where they bear
 * on the decision — as warnings, never as blocks.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useLang } from "@/context/LangContext";
import { authedFetch } from "@/lib/authed-fetch";
import { co } from "@/lib/i18n.changeover";
import { pd } from "@/lib/i18n.prod";
import { formatClock, formatDate, todayIso } from "@/lib/dates";
import { ageLabel, fill, fmtInt, fmtNum } from "@/lib/format";
import { DOWNTIME_CAPTURE_REASONS, type Tone } from "@/lib/prod-meta";
import {
  ANY_COLOUR, COLOURS, MAP_COLS, MAP_MAX_ROWS, MAP_NAME, MAP_TILE, MISSING_ITEMS,
  barrelOf, colourDef, colourKey, estimateFrom, fitFloor, fold, freeSpot, machineFinished, machineKey, stoppageFault, placeTile, planDay,
  rankFor, removeTile, sortByUrgency, splitMinutes, stockState, stoppageKind, tileHeightPx, tileWidthPx, turnLayout, urgencyChips,
  type DayEntry, type DayNeed, type Estimate, type FloorFit,
  type Chip, type ChipTone, type MachineState, type MapTile, type MissingKey, type PlanMachine, type PlanOrder,
  type Suggestion,
} from "@/lib/changeover";
import type { ChangeoverResponse, MountResult } from "@/lib/changeover-data";
import { timedJson } from "@/components/dashboard/last-seen";
import { useRemembered } from "@/components/dashboard/use-remembered";
import { Btn, EmptyState, LoadError, Modal, Pill, Spinner, StatTile, iconBtnCls, inputCls } from "@/components/dashboard/ui";
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, HelpCircle, LayoutGrid, List, ListChecks, Maximize2, Pencil, RefreshCw, RotateCw, X } from "lucide-react";

// v3 (2026-10-05): the answer gained fields the page reads on every card; a
// snapshot in the old shape is not shown under the new code.
// v5 (2026-10-07): again — `ranOn`, `stock`, `asOf` on every order, the
// machine's own change time, the store's material list. An old snapshot has
// no `ranOn` list at all, and the ranking reads it for every order.
const LAST_KEY = "itqan.changeover.last.v6";
const STALE_AFTER_MS = 60_000;
const CHIP_TONE: Record<ChipTone, Tone> = { good: "green", warn: "amber", bad: "red", info: "blue" };
const STATE_TONE: Record<MachineState, Tone> = { running: "green", stopped: "red", idle: "amber", unknown: "gray" };
const STATE_DOT: Record<MachineState, string> = { running: "bg-emerald-500", stopped: "bg-red-500", idle: "bg-amber-500", unknown: "bg-gray-300" };
const STATES: readonly MachineState[] = ["running", "stopped", "idle", "unknown"];
/** The number on a day card that needs a mould now, in its machine's state colour. */
const STATE_NUM: Record<MachineState, string> = {
  running: "border-emerald-500 text-emerald-700", stopped: "border-red-500 text-red-700",
  idle: "border-amber-500 text-amber-800", unknown: "border-gray-400 text-gray-600",
};
/** The chips the day's plan shows: why THIS order, and what makes the change a hard one —
 *  a mould that has to come off ANOTHER machine first is one (it was not said at all). */
const DAY_CHIPS = new Set([
  "keyClient", "late", "atRisk", "dueToday", "dueTomorrow", "dueTwoDays", "dueSoon", "noDueDate",
  "mountedElsewhere", "ranHere", "stockNone", "stockLow", "toTransparent", "lighter", "materialChange", "transparentMachine",
]);
/**
 * The day's plan in the groups it is read in (lib/changeover.ts DayNeed, in
 * planDay's own order). "down" is a machine whose stoppage means it cannot
 * run anything now — listed so nobody looks for it, never given a mould
 * (owner, 2026-10-07: the plan had given a late order to a machine that was
 * down for repair).
 */
const DAY_GROUPS = {
  now: ["finished", "free", "stopped", "overrun"],
  soon: ["interrupt", "soon"],
  down: ["down"],
  running: ["running"],
} as const satisfies Record<string, readonly DayNeed[]>;
type DayGroup = keyof typeof DAY_GROUPS;
const DAY_GROUP_KEYS = Object.keys(DAY_GROUPS) as DayGroup[];
const inGroup = (g: DayGroup, need: DayNeed): boolean => (DAY_GROUPS[g] as readonly DayNeed[]).includes(need);
const STATE_TILE: Record<MachineState, string> = {
  running: "border-emerald-400 bg-white",
  stopped: "border-red-400 bg-red-50",
  idle: "border-amber-400 bg-amber-50",
  unknown: "border-gray-300 bg-gray-50",
};
const STATE_WORD: Record<MachineState, string> = { running: "text-emerald-700", stopped: "text-red-700", idle: "text-amber-700", unknown: "text-gray-500" };
const CHECKS = ["material", "packaging", "connections", "mould", "sample", "workers"] as const;

type Strings = (typeof co)["en"];

/**
 * An answer built on a read that failed. Every sheet read degrades to an
 * EMPTY tab rather than an error, so a bad moment at the bridge arrives here
 * as "not connected", "no machines" or "no production log" with a 200 — seen
 * live on 2026-10-05, when it blanked a page that had been showing the floor
 * a second earlier. Such an answer is shown only when there is nothing better.
 */
const degraded = (r: ChangeoverResponse): boolean =>
  !r.ok || !r.configured || r.logRead === false || r.masterRead === false || r.plannerRead === false
  || r.machines.length === 0;
type PostResult = { ok: boolean; reason?: string } & Record<string, unknown>;

async function post(body: Record<string, unknown>): Promise<PostResult> {
  try {
    const res = await authedFetch("/api/changeover", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as PostResult | null;
    return json ?? { ok: false, reason: "generic" };
  } catch {
    return { ok: false, reason: "generic" };
  }
}

/** A machine label («PQ 1 — 550») inside an Arabic sentence: isolate it, or
 *  the bidi algorithm prints «550 — 1 PQ». */
const ltr = (label: string): string => `\u2066${label}\u2069`;

const errorText = (s: Strings, reason: string | undefined): string =>
  (s.errors as Record<string, string>)[reason ?? ""] ?? s.errors.generic;

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

/** «PQ 7 — 100» → the code and the tonnage, for a tile too small for both on one line. */
const codeOf = (label: string): string => label.split(/\s+[—–-]\s+/)[0] || label;
const tonOf = (label: string): string => label.split(/\s+[—–-]\s+/)[1] ?? "";
/** A list of machines inside a sentence: «PQ 3 · PQ 12», left to right, and a
 *  code is never split over two lines («PQ» ending one and «12» starting the next). */
const codesText = (labels: readonly string[]): string => ltr(labels.map((l) => codeOf(l).replace(/ /g, " ")).join(" · "));

/** The Cairo clock right now as an hour of the day (14.5 = 14:30) — what
 *  planDay counts "finishes in" from. Noon when the clock cannot be read, as
 *  planDay itself assumes. Read when an answer lands, never while drawing. */
const cairoHourNow = (): number => {
  const [h, m] = formatClock(Date.now()).split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h + m / 60 : 12;
};

/** A name inside a chip: a chip is one line and must not push a phone sideways. */
const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

/** Kilograms: whole, except a small amount, where a tenth still means something. */
const kgText = (kg: number, isAr: boolean): string => (Math.abs(kg) < 10 && kg % 1 !== 0 ? fmtNum(kg, isAr, 1) : fmtInt(kg, isAr));

/* --------------------------------- colours -------------------------------- */

function colourName(key: string, isAr: boolean, s: Strings): string {
  if (!key) return "";
  if (key === ANY_COLOUR) return s.colours.any;
  const d = colourDef(key);
  return d ? (isAr ? d.ar : d.en) : key;
}

function Swatch({ colour, size = "w-3.5 h-3.5" }: { colour: string; size?: string }) {
  const d = colourDef(colour);
  return (
    <span
      aria-hidden="true"
      className={`inline-block ${size} rounded-full border border-gray-400/70 shrink-0 align-[-2px]`}
      style={{ background: d ? d.swatch : "repeating-linear-gradient(45deg,#e5e7eb,#e5e7eb 3px,#fff 3px,#fff 6px)" }}
    />
  );
}

/** The colours of a job, named: «● أبيض  ● رمادي». */
function ColourTags({ colours, isAr, s, guessed }: { colours: readonly string[]; isAr: boolean; s: Strings; guessed?: boolean }) {
  if (colours.length === 0) return <span className="text-amber-700">{s.now.noColour}</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {colours.map((c) => (
        <span key={c} className="inline-flex items-center gap-1 whitespace-nowrap"><Swatch colour={c} />{colourName(c, isAr, s)}</span>
      ))}
      {guessed && <span className="text-amber-700" aria-hidden="true">؟</span>}
    </span>
  );
}

const LAMP: Record<MachineState, string> = { running: "#10b981", stopped: "#ef4444", idle: "#f59e0b", unknown: "#cbd5e1" };

/** The hatch that stands for "colour not known" — defined once, used by every glyph. */
function GlyphDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true">
      <defs>
        <pattern id="co-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="4" height="4" fill="#ffffff" />
          <rect width="1.6" height="4" fill="#cbd5e1" />
        </pattern>
      </defs>
    </svg>
  );
}

/**
 * An injection press from the side, the way it stands on the floor: clamp
 * unit with its tonnage, the mould between the platens, the barrel and the
 * hopper. The hopper carries every colour the job is made in and the barrel
 * the one in it now — which is what the engineer looks at before a change —
 * and the lamp says whether it is running. Decorative: the tile's own text
 * says all of it again in words.
 */
function MachineGlyph({ colours, now, tonnage, state, className, style }: {
  colours: readonly string[]; now: string; tonnage: string; state: MachineState; className?: string; style?: React.CSSProperties;
}) {
  const fillOf = (c: string) => colourDef(c)?.swatch ?? "url(#co-hatch)";
  const stripes = colours.length > 0 ? colours.slice(0, 4) : [""];
  const sw = 16 / stripes.length;
  const barrel = now || (colours.length === 1 ? colours[0] : "");
  // Compact on purpose: a narrower drawing scales up larger inside a phone's
  // 88px tile, and the tonnage on the clamp stays readable there.
  return (
    <svg viewBox="0 0 100 38" preserveAspectRatio="xMidYMid meet" className={className ?? "block w-full flex-1 min-h-0 my-0.5"} style={style} aria-hidden="true">
      {/* the bed, on two feet */}
      <rect x="2" y="28" width="96" height="5" rx="1.5" fill="#94a3b8" />
      <rect x="8" y="33" width="9" height="3" fill="#64748b" />
      <rect x="83" y="33" width="9" height="3" fill="#64748b" />
      {/* clamp unit, with the tonnage and the lamp */}
      <rect x="3" y="9" width="33" height="19" rx="2.5" fill="#334155" />
      <text x="19.5" y="22.5" textAnchor="middle" fontSize="11.5" fontWeight="700" fill="#ffffff" fontFamily="system-ui, sans-serif">{tonnage}</text>
      <rect x="7.1" y="4.5" width="1.8" height="5" fill="#64748b" />
      <circle cx="8" cy="4" r="3.4" fill={LAMP[state]} stroke="#ffffff" strokeWidth="0.9" />
      {/* tie bars, platens and the mould */}
      <rect x="36" y="13" width="17" height="1.6" fill="#94a3b8" />
      <rect x="36" y="23" width="17" height="1.6" fill="#94a3b8" />
      <rect x="37.5" y="7" width="3.6" height="21" rx="0.8" fill="#1e293b" />
      <rect x="41.1" y="11" width="4" height="13.5" fill="#b45309" />
      <rect x="45.4" y="11" width="4" height="13.5" fill="#d97706" />
      <rect x="49.4" y="7" width="3.6" height="21" rx="0.8" fill="#1e293b" />
      {/* nozzle, barrel (the colour in it now) and drive */}
      <path d="M53 18.5 l4.5 -3.2 v6.4 z" fill="#64748b" />
      <rect x="57.5" y="14.5" width="26" height="8" rx="1.4" fill={barrel ? fillOf(barrel) : "url(#co-hatch)"} stroke="#475569" strokeWidth="1" />
      <rect x="83.5" y="11" width="13.5" height="17" rx="2" fill="#475569" />
      {/* hopper: one stripe per colour the job is made in */}
      {stripes.map((c, i) => (
        <rect key={i} x={64 + i * sw} y="2" width={sw} height="8" fill={c ? fillOf(c) : "url(#co-hatch)"} />
      ))}
      <path d="M64 10 H80 L75 14.5 H69 Z" fill={stripes[0] ? fillOf(stripes[0]) : "url(#co-hatch)"} />
      <path d="M64 2 H80 V10 L75 14.5 H69 L64 10 Z" fill="none" stroke="#475569" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The floor, drawn for the frame it is given (lib/changeover.ts fitFloor) — a
 * LANDSCAPE plan (owner, 2026-10-07: "I want the map itself to be
 * landscape"). In the page it is as wide as the frame, and a frame too narrow
 * for the machines to be read pans sideways rather than stand the floor up.
 * `fill` is the full-screen view: the whole floor fitted into the frame both
 * ways. `whole` is the editor: the full sheet, unsqueezed.
 */
function Floor({ tiles, whole, fill, sheetRef, onSheetClick, children }: {
  tiles: readonly MapTile[]; whole?: boolean; fill?: boolean; sheetRef?: React.RefObject<HTMLDivElement | null>;
  onSheetClick?: (e: React.MouseEvent<HTMLDivElement>) => void; children: (fit: FloorFit) => React.ReactNode;
}) {
  // The frame is measured, not guessed: the same page is a phone held either
  // way, a tablet and a desk. (clientWidth is the frame's own size even when
  // the full-screen view is drawn turned.)
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!frame) return;
    const read = () => setBox((b) => (b.w === frame.clientWidth && b.h === frame.clientHeight ? b : { w: frame.clientWidth, h: frame.clientHeight }));
    read();
    const watch = new ResizeObserver(read);
    watch.observe(frame);
    return () => watch.disconnect();
  }, [frame]);
  const width = box.w;
  const fit = useMemo(() => fitFloor(tiles, width, fill ? { fill: box.h } : { whole }), [tiles, width, box.h, whole, fill]);
  const step = whole ? 1 : 4;
  return (
    <div ref={setFrame} className={fill ? "h-full w-full flex items-center overflow-hidden" : "overflow-x-auto rounded-2xl border border-slate-300"} dir="ltr">
      {width > 0 && (
        <div
          ref={sheetRef} onClick={onSheetClick} className={`relative grid ${fill ? "rounded-xl" : ""}`}
          style={{
            width: fit.pans ? fit.width : "100%",
            gridTemplateColumns: fit.colFr.map((f) => `minmax(0, ${f}fr)`).join(" "),
            gridTemplateRows: fit.rowFr.map((f) => `${f * fit.unitH}px`).join(" "),
            // The shop floor: a faint tiled ground under the machines.
            backgroundColor: "#eef2f6",
            backgroundImage: "linear-gradient(#dde3ea 1px, transparent 1px), linear-gradient(90deg, #dde3ea 1px, transparent 1px)",
            backgroundSize: `${fit.unitW * step}px ${fit.unitH * step}px`,
          }}
        >
          {children(fit)}
        </div>
      )}
    </div>
  );
}

/** Is this a phone held sideways — a touch screen wider than tall, and short?
 *  Judged by the WINDOW (screen.orientation is not kept up to date
 *  everywhere), so a keyboard opening over an upright phone must not count:
 *  on some browsers it leaves a window wider than it is tall. */
function heldSideways(): boolean {
  if (typeof window === "undefined") return false;
  const touch = navigator.maxTouchPoints > 0 || window.matchMedia("(pointer: coarse)").matches;
  const el = document.activeElement as HTMLElement | null;
  const typing = !!el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable);
  return touch && !typing && window.innerWidth > window.innerHeight && window.innerHeight <= 540;
}

/**
 * The floor on the whole screen, landscape — what a phone is turned sideways
 * for. In a window that is taller than wide (a phone held upright, or one
 * whose rotation is locked) the view is drawn turned a quarter, so turning
 * the phone reads it; when the browser rotates the page itself, it is not.
 * Nothing scrolls and nothing pans: the whole floor is on the screen.
 */
function FloorScreen({ title, closeLabel, legend, onClose, children }: {
  title: string; closeLabel: string; legend: React.ReactNode; onClose: () => void; children: React.ReactNode;
}) {
  const [win, setWin] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const read = () => setWin({ w: window.innerWidth, h: window.innerHeight });
    read();
    window.addEventListener("resize", read);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    const was = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("resize", read); window.removeEventListener("keydown", key); document.body.style.overflow = was; };
  }, [onClose]);
  if (!win) return null;
  const upright = win.h > win.w;
  const w = upright ? win.h : win.w, h = upright ? win.w : win.h;
  return createPortal(
    <div
      role="dialog" aria-modal="true" aria-label={title}
      className="fixed top-0 left-0 z-[70] flex flex-col bg-slate-100"
      style={{
        width: w, height: h,
        ...(upright ? { transformOrigin: "top left", transform: `translateX(${win.w}px) rotate(90deg)` } : null),
      }}
    >
      <div className="shrink-0 h-9 flex items-center gap-3 ps-3 bg-white border-b border-slate-200">
        <span className="text-sm font-bold text-gray-900 whitespace-nowrap">{title}</span>
        <span className="min-w-0 flex-1 flex items-center gap-x-3 overflow-hidden text-xs text-gray-600 whitespace-nowrap">{legend}</span>
        <button type="button" onClick={onClose} aria-label={closeLabel}
          className="shrink-0 h-9 min-w-14 px-3 inline-flex items-center justify-center gap-1 text-sm font-medium text-gray-800 border-s border-slate-200 hover:bg-gray-50 active:bg-gray-100">
          <X size={16} />{closeLabel}
        </button>
      </div>
      <div className="flex-1 min-h-0 p-1">{children}</div>
    </div>,
    document.body,
  );
}

const chipCls = (active: boolean, tone: "blue" | "red" | "green" = "blue") => {
  const on = tone === "red" ? "border-red-400 bg-red-50 text-red-800" : tone === "green" ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-blue-500 bg-blue-50 text-blue-800";
  return `inline-flex items-center justify-center gap-1.5 min-h-11 px-3 rounded-lg border text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
    active ? `${on} font-medium` : "border-gray-300 text-gray-700 hover:bg-gray-50 active:bg-gray-100"
  }`;
};

/**
 * Tap every colour the job is made in — a product is often run in several and
 * nothing else in the workbook holds them. «لون آخر» adds one the list does
 * not have.
 */
function ColourPicker({ value, onChange, isAr, s, allowAny }: {
  value: string[]; onChange: (keys: string[]) => void; isAr: boolean; s: Strings; allowAny?: boolean;
}) {
  const [other, setOther] = useState(false);
  const [text, setText] = useState("");
  const toggle = (key: string) => onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value.filter((k) => k !== ANY_COLOUR), key]);
  const custom = value.filter((k) => k !== ANY_COLOUR && !colourDef(k));
  const add = () => {
    const k = colourKey(text);
    if (k && !value.includes(k)) onChange([...value.filter((x) => x !== ANY_COLOUR), k]);
    setText(""); setOther(false);
  };
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {COLOURS.map((c) => (
          <button key={c.key} type="button" aria-pressed={value.includes(c.key)} className={chipCls(value.includes(c.key))} onClick={() => toggle(c.key)}>
            <Swatch colour={c.key} />{isAr ? c.ar : c.en}
          </button>
        ))}
        {custom.map((k) => (
          <button key={k} type="button" aria-pressed className={chipCls(true)} onClick={() => toggle(k)}><Swatch colour={k} />{k}</button>
        ))}
        {allowAny && (
          <button type="button" aria-pressed={value.includes(ANY_COLOUR)} className={chipCls(value.includes(ANY_COLOUR))}
            onClick={() => onChange(value.includes(ANY_COLOUR) ? [] : [ANY_COLOUR])}>
            {s.colours.any}
          </button>
        )}
        <button type="button" aria-expanded={other} className={chipCls(other)} onClick={() => setOther((v) => !v)}>{s.colours.other}</button>
      </div>
      {other && (
        <div className="flex gap-2 mt-2">
          <input className={inputCls} value={text} placeholder={s.colours.otherPlaceholder} aria-label={s.colours.other} maxLength={40}
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
          <Btn variant="outline" onClick={add}>{s.colours.add}</Btn>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------- page ---------------------------------- */

export default function ChangeoverPage() {
  const { lang } = useLang();
  const isAr = lang === "ar";
  const s = co[lang];
  const p = pd[lang];
  usePageTitle(s.title);

  const freshNext = useRef(false);
  const loadRef = useRef<() => Promise<void>>(async () => {});
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const staleRefetches = useRef(0);
  // The Cairo hour the day's plan is made at: read when the page opens and
  // again with every live answer — "finishes in" is hours on the clock.
  const [hourNow, setHourNow] = useState(cairoHourNow);
  const { data, loading, failed, setFailed, fromSnapshot, reload } = useRemembered<ChangeoverResponse>({
    key: LAST_KEY,
    read: () => timedJson<ChangeoverResponse>(authedFetch, freshNext.current ? "/api/changeover?fresh=1" : "/api/changeover"),
    valid: (snap) => Array.isArray(snap?.machines) && Array.isArray(snap?.orders) && Array.isArray(snap?.layout)
      && Array.isArray(snap?.storeMaterials),
    // A snapshot's age is the device's past, not now.
    hydrate: (snap) => ({ ...snap, dataAgeMs: 0 }),
    // A degraded answer is shown when there is nothing better, never
    // remembered, and never allowed to replace a good one already on screen —
    // the page keeps what it showed and says the refresh failed.
    worthRemembering: (next) => !degraded(next),
    merge: (prev, next) => (degraded(next) && prev && !degraded(prev) ? prev : next),
    onLoaded: (next) => {
      setHourNow(cairoHourNow());
      if (degraded(next)) { setFailed({ timedOut: false }); return; }
      // An old copy was served (and is being refreshed server-side): ask once
      // more in a few seconds. Bounded, the same way the stock page does it —
      // a bridge that stays down must not turn this into a poll.
      if ((next.dataAgeMs ?? 0) <= STALE_AFTER_MS) staleRefetches.current = 0;
      else if (!refetchTimer.current && staleRefetches.current < 2) {
        staleRefetches.current += 1;
        refetchTimer.current = setTimeout(() => { refetchTimer.current = null; void loadRef.current(); }, 8000);
      }
    },
  });
  loadRef.current = reload;
  useEffect(() => () => { if (refetchTimer.current) clearTimeout(refetchTimer.current); }, []);
  /** After a save: read the page's own tabs past the cache, then go back to cached reads. */
  const reloadFresh = useCallback(async () => {
    freshNext.current = true;
    try { await reload(); } finally { freshNext.current = false; }
  }, [reload]);

  const [selected, setSelected] = useState("");
  const [view, setView] = useState<"map" | "list">("map");
  // Three tabs (owner, 2026-10-07: "make tabs and pages inside it to be more
  // organized"); a tapped machine is its own screen with two of its own.
  const [tab, setTab] = useState<"floor" | "day" | "orders">("floor");
  const [mtab, setMtab] = useState<"now" | "next">("next");
  const [arranging, setArranging] = useState(false);
  // The floor on the whole screen. Turning the phone sideways opens it (and
  // turning it back closes what the turn opened); closing it by hand keeps it
  // closed until the phone is turned again.
  const [wide, setWide] = useState(false);
  const wideByTurn = useRef(false);
  const wideShut = useRef(false);
  useEffect(() => {
    let was: boolean | null = null;
    const check = () => {
      const now = heldSideways();
      if (now === was) return;
      was = now;
      if (now) { if (!wideShut.current) { wideByTurn.current = true; setWide(true); } }
      else { wideShut.current = false; if (wideByTurn.current) { wideByTurn.current = false; setWide(false); } }
    };
    // A turn is announced before the window has its new size on some phones
    // (and the size before the orientation on others): look now, and again
    // once it has settled.
    let later: ReturnType<typeof setTimeout> | undefined;
    const turned = () => { check(); clearTimeout(later); later = setTimeout(check, 350); };
    const mq = window.matchMedia("(orientation: landscape)");
    turned();
    window.addEventListener("resize", turned);
    window.addEventListener("orientationchange", turned);
    mq.addEventListener?.("change", turned);
    window.screen?.orientation?.addEventListener?.("change", turned);
    // …and the page's own box changing size is a turn too, whichever event the
    // browser forgot to send.
    const box = new ResizeObserver(turned);
    box.observe(document.documentElement);
    return () => {
      box.disconnect();
      clearTimeout(later);
      window.removeEventListener("resize", turned);
      window.removeEventListener("orientationchange", turned);
      mq.removeEventListener?.("change", turned);
      window.screen?.orientation?.removeEventListener?.("change", turned);
    };
  }, []);
  const closeWide = useCallback(() => { wideShut.current = heldSideways(); wideByTurn.current = false; setWide(false); }, []);
  const [machineForm, setMachineForm] = useState<PlanMachine | null>(null);
  const [orderForm, setOrderForm] = useState<PlanOrder | null>(null);
  const [confirm, setConfirm] = useState<{ machine: PlanMachine; pick: Suggestion } | null>(null);
  const [done, setDone] = useState<MountResult | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  const machines = useMemo(() => data?.machines ?? [], [data]);
  const orders = useMemo(() => data?.orders ?? [], [data]);
  const layout = useMemo(() => data?.layout ?? [], [data]);

  // A machine is opened by a TAP now — it is its own screen, and opening one
  // by itself would hide the three tabs. One that left the registry is closed.
  useEffect(() => {
    if (selected && machines.length > 0 && !machines.some((m) => m.label === selected)) setSelected("");
  }, [machines, selected]);

  const machine = machines.find((m) => m.label === selected) ?? null;
  const transparentMachines = useMemo(() => machines.filter((m) => m.transparentOnly).map((m) => m.label), [machines]);
  const plan = useMemo(
    () => (machine ? rankFor(machine, orders, { today: data?.today ?? "", transparentMachines }) : { ranked: [], blocked: [] }),
    [machine, orders, data?.today, transparentMachines],
  );
  const orderOf = useCallback(
    (m: PlanMachine) => (m.now.order ? orders.find((o) => o.code === m.now.order) ?? null : null),
    [orders],
  );
  /**
   * The whole floor in the order things have to be done (lib/changeover.ts
   * planDay): the machines, each with the mould to put on it — and the urgent
   * orders the plan could not put anywhere, which are said, never hidden.
   */
  const dayPlan = useMemo(
    // (nowMs is read when the data changes — a change in progress frees its
    // team to the minute the plan was last worked out, which is close enough.)
    () => planDay(machines, orders, { today: data?.today ?? "", transparentMachines, hourNow, nowMs: Date.now(), daysOff: data?.daysOff ?? [] }),
    [machines, orders, data?.today, data?.daysOff, transparentMachines, hourNow],
  );
  const day = dayPlan.entries;

  const minutes = useCallback((min: number) => {
    const { h, m } = splitMinutes(min);
    if (h > 0 && m > 0) return fill(s.rank.hoursMinutes, { h, m });
    return h > 0 ? fill(s.rank.hours, { h }) : fill(s.rank.minutes, { m });
  }, [s]);
  const chipText = useCallback((c: Chip, strings: Strings = s, ar = isAr) => {
    // Arabic counts its days: يوم، يومين، 3–10 أيام، 11+ يوم.
    const n = Number(c.vars?.n);
    const key =
      c.key === "late" ? (n === 1 ? "lateOne" : n === 2 ? "lateTwo" : n <= 10 ? "lateFew" : "late")
      : c.key === "workers" && n === 2 ? "workersTwo"
      : c.key;
    const vars: Record<string, string | number> = { ...(c.vars ?? {}) };
    if (typeof vars.colour === "string") vars.colour = colourName(vars.colour, ar, strings);
    if (typeof vars.machine === "string") vars.machine = ltr(vars.machine);
    if (typeof vars.machines === "string") vars.machines = ltr(vars.machines);
    if (typeof vars.order === "string") vars.order = ltr(vars.order);
    // The store's own material names run long («بولي بروبلين كوبوليمر …») and
    // a chip is one unbreakable line: the full name is on the «الأوامر» tab.
    if (typeof vars.material === "string") vars.material = clip(vars.material, 16);
    if (c.key === "stockLow") { vars.have = fmtInt(Number(vars.have), ar); vars.need = fmtInt(Number(vars.need), ar); }
    return fill((strings.chips as Record<string, string>)[key] ?? c.key, vars);
  }, [s, isAr]);
  const missingText = useCallback((keys: string) =>
    keys.split(",").map((k) => { const it = MISSING_ITEMS.find((x) => x.key === k); return it ? (isAr ? it.ar : it.en) : k; }).join(isAr ? "، " : ", "), [isAr]);

  /** When a running stoppage started: «08:02», with the day when it is not today's. */
  const stoppageSince = useCallback((m: PlanMachine) => {
    if (!m.stoppage) return "";
    const day = todayIso(m.stoppage.since);
    const clock = formatClock(m.stoppage.since);
    return day === data?.today ? clock : `${formatDate(day, lang)} ${clock}`;
  }, [lang, data?.today]);
  /** «توقف مسجّل: لا يوجد أمر شغل — من 08:02», with the day when it is not today's. */
  const stoppageText = useCallback((m: PlanMachine) => {
    if (!m.stoppage) return "";
    const r = DOWNTIME_CAPTURE_REASONS.find((x) => x.key === m.stoppage!.reason);
    return fill(s.now.stoppage, {
      reason: r ? (isAr ? r.ar : r.en) : m.stoppage.reason,
      since: stoppageSince(m),
    });
  }, [s, isAr, stoppageSince]);

  /** «5 س» / «3 يوم»: hours, to the precision an eye wants. */
  const roughly = useCallback((hours: number) => {
    if (hours >= 48) return fill(s.day.days, { d: fmtInt(Math.round(hours / 24), isAr) });
    if (hours >= 1) return fill(s.day.hours, { h: fmtInt(Math.round(hours), isAr) });
    return fill(s.rank.minutes, { m: Math.max(10, Math.round((hours * 60) / 10) * 10) });
  }, [s, isAr]);
  const reasonText = useCallback((m: PlanMachine) => {
    const r = DOWNTIME_CAPTURE_REASONS.find((x) => x.key === m.stoppage?.reason);
    return r ? (isAr ? r.ar : r.en) : m.stoppage?.reason ?? "";
  }, [isAr]);
  /** Who is at fault on the machine a mould stands on (lib/changeover.ts stoppageFault). */
  const faultAt = useCallback((label: string) => {
    const m = machines.find((x) => machineKey(x.label) === machineKey(label));
    return m ? stoppageFault(m.stoppage?.reason) : "none";
  }, [machines]);
  // The one-tap answers outside a form (a guessed store material, the machines
  // the log says run transparent): which one is being saved, "" when none.
  const [quick, setQuick] = useState("");
  const [quickError, setQuickError] = useState("");
  const quickSave = useCallback(async (id: string, items: { kind: string; name: string; values: Record<string, unknown> }[]) => {
    setQuick(id); setQuickError("");
    const r = await post({ action: "answers", items });
    if (!r.ok) setQuickError(errorText(s, r.reason));
    else await reloadFresh();
    setQuick("");
  }, [s, reloadFresh]);

  /** A machine recorded «لا يوجد أمر شغل» has FINISHED — said in its own word. */
  const stateWord = useCallback((m: PlanMachine) => (machineFinished(m) ? s.machines.finished : s.states[m.state]), [s]);

  /**
   * What goes in small grey beside a forecast (owner, 2026-10-07: the forecast
   * allows for the log being typed late): the day's log it was counted forward
   * from, and — when no shift of the order has been counted yet — that it is
   * only «الرئيسي»'s cycle time. "" when there is nothing to add.
   */
  const forecastNote = useCallback((o: PlanOrder | null) => (!o ? "" : [
    o.asOf ? fill(s.day.asOf, { date: formatDate(o.asOf, lang) }) : "",
    o.runBasis === "master" ? s.day.fromCycle : "",
  ].filter(Boolean).join(" · ")), [s, lang]);
  /**
   * The floor said «لا يوجد أمر شغل» and the count says more than a shift is
   * still to make (PlanOrder.doneUnsure): the page cannot tell which is wrong,
   * so it says both and what to do about each. The count as it is LOGGED.
   */
  const unsureText = useCallback((o: PlanOrder) => fill(s.unsure.text, {
    n: o.remaining !== null ? `${fmtInt(o.remaining, isAr)} ${s.rank.pieces}` : o.runHours !== null ? roughly(o.runHours) : s.rank.noQty,
  }), [s, isAr, roughly]);
  /** The mould-swap minutes are this machine's own (PlanMachine.swapMin), not a fixed number. */
  const swapNote = useCallback((m: PlanMachine, est: Estimate) =>
    (est.swapMeasured && !est.sameMould ? fill(s.rank.swapMeasured, { n: fmtInt(m.swapSamples, isAr) }) : ""), [s, isAr]);
  /**
   * The store material behind a «مفيش … في المخزن» / «الخامة ناقصة» chip is only
   * a GUESS — nobody has answered which material the product is made of. Said
   * beside the chip, as a guessed colour always is: it was stated as a fact of
   * the store wherever the chip showed. "" when it is the supervisor's answer.
   */
  const stockGuessNote = useCallback((o: PlanOrder) => {
    const state = stockState(o);
    return o.stock?.guessed && (state === "none" || state === "low") ? s.ordersTab.stockGuessed : "";
  }, [s]);

  /**
   * The one-tap answers to the page's own questions about a machine. Each is a
   * «الراكب الآن» row — the thing «تعديل» writes — sent with what the page is
   * showing: «نعم» ties the order, «لا» records that the job has none, «لسه
   * هنا» / «الاتنين راكبين» name what stands, «اتغيّرت» names what came off.
   * (They used to say "open «Edit» and save", and an unchanged form saves
   * nothing — the question could not be answered.)
   */
  const [tying, setTying] = useState(false);
  const [tieError, setTieError] = useState("");
  const noteNow = useCallback(async (m: PlanMachine, extra: Record<string, unknown> = {}) => {
    if (tying) return;
    setTying(true); setTieError("");
    const r = await post({
      action: "mount", baseline: true, machine: m.label,
      order: m.now.order && !m.now.order.startsWith("#") ? m.now.order : "",
      noOrder: m.now.noOrder,
      products: m.now.products,
      // A guess is never written down by a tap that was about something else.
      colours: m.now.coloursGuessed ? [] : m.now.colours, colourNow: m.now.coloursGuessed ? "" : m.now.colourNow,
      fromProducts: [], fromColours: [],
      ...extra,
    });
    setTying(false);
    if (!r.ok) { setTieError(errorText(s, r.reason)); return; }
    await reloadFresh();
  }, [tying, s, reloadFresh]);

  const pick = useCallback((label: string) => {
    const m = machines.find((x) => x.label === label);
    setSelected(label);
    setTieError("");
    // The machine opens as its own screen — on the question the page has about
    // it when there is one (a floor word the count disagrees with is one),
    // else on what goes on it next.
    setMtab(m && (m.now.orderMaybe || m.now.alsoOn || m.now.mixedShift || orderOf(m)?.doneUnsure) ? "now" : "next");
    requestAnimationFrame(() => panelRef.current?.scrollIntoView({ block: "start" }));
  }, [machines, orderOf]);

  /* --------------------------------- states --------------------------------- */

  if (failed && !data) {
    return (
      <div dir={isAr ? "rtl" : "ltr"}>
        <h1 className="text-2xl font-bold text-gray-900 mb-4">{s.title}</h1>
        <LoadError variant="empty" text={failed.timedOut ? p.common.timedOut : s.loadError} retry={p.common.retry} onRetry={reload} loading={loading} />
      </div>
    );
  }
  if (!data) return <div className="flex justify-center py-16"><Spinner text={p.common.loading} /></div>;
  if (!data.configured) {
    return (
      <div dir={isAr ? "rtl" : "ltr"}>
        <h1 className="text-2xl font-bold text-gray-900 mb-4">{s.title}</h1>
        {/* A read that failed looks exactly like a sheet that is not connected;
            `failed` is set for every degraded answer, so offer the retry. */}
        {failed
          ? <LoadError variant="empty" text={s.loadError} retry={p.common.retry} onRetry={reload} loading={loading} />
          : <EmptyState text={s.notConnected} />}
      </div>
    );
  }

  // Nothing is written from a view that is not the live one: a device
  // snapshot of unknown age, or what was kept on screen after a refresh
  // failed. Mounting on a machine whose state has since changed is the one
  // mistake this page must not make easy.
  const live = !fromSnapshot && !failed && !degraded(data);
  const canWrite = data.writable && live;
  const count = (st: MachineState) => machines.filter((m) => m.state === st).length;
  const waiting = orders.filter((o) => !(o.mountedOn && o.mountedRunning) && o.remaining !== 0).length;
  const placed = new Set(layout.map((t) => machineKey(t.label)));
  const unplaced = machines.filter((m) => !placed.has(machineKey(m.label)));
  const showMap = view === "map" && layout.length > 0;

  /** A machine as one square of the floor. */
  const tile = (m: PlanMachine, t: MapTile, fit: FloorFit, after?: () => void) => {
    const isSel = m.label === selected;
    // What the tile really has, in px (3px of air, 2px of border and 3px of padding a side).
    const w = tileWidthPx(fit, t) - 16, h = tileHeightPx(fit, t) - 16;
    // A flat tile — or one too low to stack a drawing over a name: the drawing
    // sits BESIDE the words. Else it sits over them.
    const side = w >= h * 2.6 || (h < 84 && w >= 150);
    const roomy = w >= 150;
    // A low tile (a small phone held sideways) keeps two lines of name in smaller type.
    const nameSize = roomy ? 13 : h < 78 ? 11 : 12, line = Math.round(nameSize * 1.17);
    const colours = m.now.colours.slice(0, 5);
    // Stacked, the colour dots stand in a column BESIDE the drawing — a row of
    // their own would cost the name its second line.
    const dotsW = colours.length > 0 ? 14 : 0;
    const headH = roomy ? 18 : 16;
    // Stacked: the drawing takes what the name does not need — three lines of
    // name in a narrow tile, two in a roomy one.
    const glyphH = side ? Math.max(24, h - 4)
      : Math.max(22, Math.min((w - dotsW) * 0.38, h - headH - (roomy ? 2 : 3) * line - 6));
    const textH = side ? h - headH : h - headH - glyphH - 4;
    const lines = Math.max(1, Math.floor(textH / line));

    // The job's colours as dots — the one in the barrel now is ringed. Beside
    // the drawing when it is stacked; in the head line when it is not.
    const dots = colours.length > 0 && (
      <span className={side ? "flex items-center gap-1 min-w-0 flex-1 px-1" : "flex flex-col items-center justify-center gap-[3px] shrink-0"} style={side ? undefined : { width: dotsW }}>
        {colours.map((c) => (
          <span key={c} className={`inline-flex rounded-full ${c === m.now.colourNow && colours.length > 1 ? "ring-2 ring-offset-1 ring-gray-700" : ""}`}>
            <Swatch colour={c} size="w-2.5 h-2.5" />
          </span>
        ))}
        {m.now.coloursGuessed && <span className="text-[10px] leading-none text-amber-700">؟</span>}
      </span>
    );
    const head = (
      <span className="flex items-center justify-between gap-1" style={{ height: headH }}>
        <span className={`font-bold leading-none text-gray-900 whitespace-nowrap ${roomy ? "text-[15px]" : "text-[13px]"}`}>{codeOf(m.label)}</span>
        {side && dots}
        <span className={`leading-none font-medium whitespace-nowrap ${roomy ? "text-[12px]" : "text-[10.5px]"} ${STATE_WORD[m.state]}`}>{stateWord(m)}</span>
      </span>
    );
    const name = (
      <span
        className="text-gray-800 break-words overflow-hidden" dir="auto"
        style={{ fontSize: nameSize, lineHeight: `${line}px`, display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: lines }}
      >
        {m.now.products.join(" / ") || <span className="text-gray-400">{s.machines.empty}</span>}
      </span>
    );
    const glyph = (cls: string, style: React.CSSProperties) => (
      <MachineGlyph colours={m.now.colours} now={m.now.colourNow} tonnage={tonOf(m.label) || m.tonnage} state={m.state} className={cls} style={style} />
    );
    return (
      <button
        key={m.label} type="button" aria-pressed={isSel} onClick={() => { after?.(); pick(m.label); }}
        aria-label={`${m.label} · ${stateWord(m)} · ${m.now.products.join(" / ") || s.machines.empty}`}
        style={{ gridColumn: `${t.c} / span ${t.w}`, gridRow: `${t.r} / span ${t.h}` }}
        className={`m-[3px] min-w-0 min-h-0 flex ${side ? "flex-row items-center gap-2" : "flex-col"} text-start border-2 rounded-xl p-[3px] overflow-hidden shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${STATE_TILE[m.state]} ${
          isSel ? "ring-2 ring-blue-500 ring-offset-1 !border-blue-500" : ""
        }`}
      >
        {side ? (
          <>
            {glyph("block shrink-0", { height: glyphH, width: Math.min(glyphH * 2.63, w * 0.46) })}
            <span className="min-w-0 flex-1 flex flex-col justify-center">{head}{name}</span>
          </>
        ) : (
          <>
            {head}
            <span className="flex items-center shrink-0" style={{ height: glyphH, marginBlock: 2 }}>
              {glyph("block min-w-0 flex-1", { height: glyphH })}
              {dots}
            </span>
            {name}
          </>
        )}
      </button>
    );
  };

  /** A machine as one full line — the list view, and the map's "not placed" tray. */
  const row = (m: PlanMachine) => {
    const o = orderOf(m);
    const isSel = m.label === selected;
    return (
      <button
        key={m.label} type="button" aria-pressed={isSel} onClick={() => pick(m.label)}
        className={`w-full text-start bg-white border rounded-xl px-3 py-2.5 transition-colors hover:bg-gray-50 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
          isSel ? "border-blue-500 ring-2 ring-blue-500/20" : "border-gray-200"
        }`}
      >
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold text-gray-900 whitespace-nowrap" dir="ltr">{m.label}</span>
          <Pill text={s.states[m.state]} tone={STATE_TONE[m.state]} />
        </span>
        <span className="block text-sm text-gray-800 mt-1 break-words">
          {m.now.products.join(" / ") || <span className="text-gray-400">{s.machines.empty}</span>}
        </span>
        {m.now.products.length > 0 && (
          <span className="block text-xs text-gray-500 mt-1">
            <ColourTags colours={m.now.colours} isAr={isAr} s={s} guessed={m.now.coloursGuessed} />
            {o && <> · <span dir="ltr">{o.code}</span>{o.remaining !== null && <> · {fill(s.machines.left, { n: `${fmtInt(o.remaining, isAr)} ${s.rank.pieces}` })}</>}</>}
            {m.now.since && <> · {fill(m.state === "idle" ? s.now.idleSince : s.now.lastShift, { date: formatDate(m.now.since, lang) })}</>}
          </span>
        )}
        {m.stoppage && <span className="block text-xs text-red-700 mt-1">{stoppageText(m)}</span>}
      </button>
    );
  };

  /** One waiting order, as ranked for the chosen machine. */
  const card = (sg: Suggestion, i: number) => {
    if (!machine) return null;
    const o = sg.order;
    const swap = swapNote(machine, sg.estimate);
    return (
      <li key={o.id} className="bg-white border border-gray-200 rounded-xl p-3 sm:p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="font-semibold text-gray-900 min-w-0 break-words">
            <span className="text-gray-400 tabular-nums">{i + 1} · </span>{o.product}
          </p>
          <p className="text-sm text-gray-600 whitespace-nowrap tabular-nums">
            {s.rank.change} {s.approx} {minutes(sg.estimate.totalMin)}
          </p>
        </div>
        <p className="text-sm text-gray-700 mt-1"><ColourTags colours={o.colours} isAr={isAr} s={s} guessed={o.colourSource === "guess"} /></p>
        <p className="text-xs text-gray-500 mt-1">
          <span dir="ltr">{o.code}</span>
          {o.client && <> · {o.client}</>}
          {" · "}{o.dueDate ? `${s.rank.due} ${formatDate(o.dueDate, lang)}` : s.rank.noDue}
          {" · "}{s.rank.remaining}{" "}
          <span className="tabular-nums">
            {o.remaining !== null ? `${fmtInt(o.remaining, isAr)} ${s.rank.pieces}`
              : o.qtyKg > 0 ? `${fmtInt(o.qtyKg, isAr)} ${s.rank.kg}` : s.rank.noQty}
          </span>
        </p>
        <div className="flex flex-wrap gap-1 mt-2">
          {sg.chips.map((c) => <Pill key={c.key} text={chipText(c)} tone={CHIP_TONE[c.tone]} />)}
        </div>
        {stockGuessNote(o) && <p className="text-[11px] text-amber-700 mt-1.5">{stockGuessNote(o)}</p>}
        {swap && <p className="text-[11px] text-gray-500 mt-1.5">{swap}</p>}
        <div className="flex flex-wrap gap-2 mt-3">
          <Btn onClick={() => setConfirm({ machine, pick: sg })} className="flex-1 sm:flex-none" disabled={!canWrite}>{s.rank.mount}</Btn>
          <Btn variant="outline" onClick={() => setOrderForm(o)} disabled={!canWrite}>
            <HelpCircle size={15} className={sg.needsAnswers ? "text-amber-600" : ""} />
            {sg.needsAnswers ? s.rank.questionsNeeded : s.rank.questions}
          </Btn>
        </div>
      </li>
    );
  };

  /**
   * One machine on the day's plan: why it is there, what goes on, what to get
   * ready. `n` numbers the machines that need a mould NOW, in the order they
   * should be seen to (owner, 2026-10-07: "I am unable to understand the plan").
   * Times are hours on the clock (`finishIn`) — a Friday in between is hours
   * in which nothing runs.
   */
  const dayCard = (e: DayEntry, n?: number) => {
    const m = e.machine, sg = e.pick;
    const why =
      e.need === "finished" ? s.day.need.finished
      : e.need === "free" ? s.day.need.free
      // «صيانة الاسطمبة»: the mould is the bad one, the machine is fine.
      : e.need === "stopped" && stoppageFault(m.stoppage?.reason) === "mould" ? s.more.mouldBad
      : e.need === "stopped" ? fill(s.day.need.stopped, { reason: reasonText(m) })
      : e.need === "overrun" ? s.day.need.overrun
      : e.need === "down" ? fill(s.day.need.down, { reason: reasonText(m), since: stoppageSince(m) })
      : e.need === "interrupt" ? s.day.need.interrupt
      // The forecast has run OUT: what was probably made since the last
      // counted day covers all that the count still shows (the log is typed a
      // day or two behind). Said in words — `roughly` never goes under ten
      // minutes, and the card read "finishes in about 10 min" all day.
      : e.need === "soon" && e.hoursLeft === 0 ? s.day.need.dueNow
      : e.finishIn !== null ? fill(e.need === "soon" ? s.day.need.soon : s.day.need.left, { t: roughly(e.finishIn) })
      : s.states[m.state];
    const verb = !sg ? ""
      : sg.order.queuedBehind ? s.day.act.sameMould
      : sg.mountedHere ? s.day.act.carryOn
      : e.need === "interrupt" ? s.day.act.takeOff
      : e.need === "soon" ? s.day.act.next
      : e.need === "stopped" ? s.day.act.canMount
      : s.day.act.mount;
    const d = sg?.estimate.drying ?? null;
    const dryH = d ? (d.minH === d.maxH ? `${d.minH}` : `${d.minH}–${d.maxH}`) : "";
    // A forecast is on the card of a job that ends soon, and of one an urgent
    // order may take the machine from — how long it still has is the trade.
    const forecast = (e.need === "soon" || e.need === "interrupt") && e.finishIn !== null;
    const note = forecast ? forecastNote(e.current) : "";
    const swap = sg && !sg.mountedHere ? swapNote(m, sg.estimate) : "";
    // The text under the head lines up with it: past the number, or past the dot.
    const lead = n !== undefined ? "ps-8" : "ps-[18px]";
    return (
      <li key={m.label}>
        <button
          type="button" onClick={() => pick(m.label)}
          className="w-full text-start bg-white border border-gray-200 rounded-xl p-3 hover:bg-gray-50 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
        >
          <span className="flex items-start gap-2">
            {n !== undefined
              ? <span className={`w-6 h-6 rounded-full border-2 bg-white text-xs font-bold leading-none tabular-nums inline-flex items-center justify-center shrink-0 ${STATE_NUM[m.state]}`}>{fmtInt(n, isAr)}</span>
              : <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${STATE_DOT[m.state]}`} />}
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-gray-800">
                <bdi dir="ltr" className="text-base font-bold text-gray-900">{codeOf(m.label)}</bdi> — {why}
              </span>
              {e.need === "interrupt" && e.finishIn !== null && (
                <span className="block text-xs text-gray-600 mt-0.5">{fill(s.day.need.left, { t: roughly(e.finishIn) })}</span>
              )}
              {note && <span className="block text-[11px] text-gray-500 mt-0.5">{note}</span>}
              {m.now.products.length > 0 && (
                <span className="block text-xs text-gray-500 mt-0.5 break-words">{s.now.title}: {m.now.products.join(" / ")}</span>
              )}
            </span>
          </span>
          {e.need === "overrun" && (
            <span className={`block mt-2 ${lead} text-xs text-amber-800`}>{s.day.overrunHint}</span>
          )}
          {e.current?.doneUnsure && (
            <span className={`flex items-start gap-1.5 mt-2 ${lead} text-xs text-amber-800`}>
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /><span className="min-w-0">{unsureText(e.current)}</span>
            </span>
          )}
          {sg ? (
            <span className={`block mt-2 ${lead}`}>
              {e.turn !== null && e.startIn !== null && (
                <span className="block text-xs text-gray-600 mb-1">
                  {e.startIn <= 0 ? fill(s.more.turnNow, { n: fmtInt(e.turn, isAr) }) : fill(s.more.turnLater, { n: fmtInt(e.turn, isAr), t: roughly(e.startIn / 60) })}
                </span>
              )}
              {e.movedFrom && <span className="block text-xs text-emerald-700 mb-1">{fill(s.more.movedFrom, { machine: ltr(codeOf(e.movedFrom)) })}</span>}
              <span className="block text-xs font-semibold text-blue-700">{verb}</span>
              <span className="block font-semibold text-gray-900 break-words">
                {sg.order.product} <span className="text-xs font-normal text-gray-400" dir="ltr">{sg.order.code}</span>
              </span>
              <span className="flex flex-wrap gap-1 mt-1">
                {sg.chips.filter((c) => DAY_CHIPS.has(c.key)).map((c) => <Pill key={c.key} text={chipText(c)} tone={CHIP_TONE[c.tone]} />)}
              </span>
              {stockGuessNote(sg.order) && <span className="block text-[11px] text-amber-700 mt-1">{stockGuessNote(sg.order)}</span>}
              {!sg.mountedHere && (
                <span className="block text-xs text-gray-600 mt-1.5">
                  {s.day.prep.change} {s.approx} {minutes(sg.estimate.totalMin)}
                  {d && <> · {e.dryIn
                    ? fill(s.day.prep.dryIn, { t: roughly(e.dryIn), h: dryH })
                    : fill(e.need === "soon" ? s.day.prep.dryNow : s.day.prep.dryBefore, { h: dryH })}</>}
                </span>
              )}
              {swap && <span className="block text-[11px] text-gray-500 mt-0.5">{swap}</span>}
              {(sg.fit !== "here" || sg.needsAnswers) && (
                <span className="block text-xs text-amber-700 mt-1">
                  {sg.fit === "unknown" ? s.day.prep.fitAsk : sg.fit === "ran" ? s.day.prep.fitRan : s.day.prep.answers}
                </span>
              )}
            </span>
          ) : (
            <span className={`block mt-2 ${lead} text-sm text-gray-500`}>{s.day.act.nothing}</span>
          )}
        </button>
      </li>
    );
  };
  // The tab's badge: machines that need a mould now, and urgent orders no
  // machine can take — the floor tab looked calm with two late orders unplaced.
  const needNow = day.filter((e) => inGroup("now", e.need)).length + dayPlan.unplaced.length;

  /**
   * The order's material in «مخزن اتقان»: what the store holds of what is
   * still needed, in kg — red when it holds none, amber when it is short.
   * Nothing at all when the store material is not known (never a zero).
   */
  const stockLine = (o: PlanOrder) => {
    const st = o.stock;
    if (!st) return null;
    const state = stockState(o);
    return (
      <p className={`text-xs mt-0.5 break-words ${state === "none" ? "text-red-700" : state === "low" ? "text-amber-700" : "text-gray-500"}`}>
        {st.needKg !== null
          ? fill(s.ordersTab.stock, { material: st.material, have: kgText(st.haveKg, isAr), need: kgText(st.needKg, isAr) })
          : fill(s.ordersTab.stockNoNeed, { material: st.material, have: kgText(st.haveKg, isAr) })}
        {st.guessed && <span className="text-amber-700"> · {s.ordersTab.stockGuessed}</span>}
        {/* One tap turns the guess into the answer (owner, 2026-10-10: "do the rest"). */}
        {st.guessed && canWrite && (
          <button type="button" disabled={quick !== ""} onClick={() => quickSave(`stock:${o.product}`, [{ kind: "mold", name: o.product, values: { storeMaterial: st.material } }])}
            className="ms-2 inline-flex items-center min-h-8 px-2.5 rounded-lg border border-gray-300 text-xs font-medium text-gray-800 bg-white hover:bg-gray-50 active:bg-gray-100 disabled:opacity-50">
            {quick === `stock:${o.product}` ? s.more.saving : s.more.stockConfirm}
          </button>
        )}
      </p>
    );
  };

  /** One open order on the «الأوامر» tab. */
  const orderRow = (o: PlanOrder) => {
    const done = !!o.doneByFloor || o.remaining === 0;
    // An answer taken back («غير محدد») is not an answer.
    const fitAnswered = !!o.fits && o.fits.length > 0;
    const on = ltr(codeOf(o.mountedOn));
    const where = done ? s.ordersTab.where.done
      : o.mountedRunning ? fill(s.ordersTab.where.running, { machine: on })
      : o.queuedBehind ? fill(s.ordersTab.where.queued, { machine: on })
      : o.mountedOn && faultAt(o.mountedOn) === "mould" ? fill(s.more.orderMouldRepair, { machine: on })
      : o.mountedOn && faultAt(o.mountedOn) === "machine" ? fill(s.more.orderMachineRepair, { machine: on })
      : o.mountedOn ? fill(s.ordersTab.where.standing, { machine: on })
      : s.ordersTab.where.waiting;
    return (
      <li key={o.id} className="px-3 py-2.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 break-words">{o.product} <span className="text-xs font-normal text-gray-400" dir="ltr">{o.code}</span></p>
          <p className="text-xs text-gray-500 mt-0.5">
            {o.client && <>{o.client} · </>}
            {o.dueDate ? <>{s.rank.due} <bdi dir="ltr">{formatDate(o.dueDate, lang)}</bdi></> : s.rank.noDue}
            {" · "}{s.rank.remaining}{" "}
            <span className="tabular-nums">
              {o.remaining !== null ? `${fmtInt(o.remaining, isAr)} ${s.rank.pieces}` : o.qtyKg > 0 ? `${fmtInt(o.qtyKg, isAr)} ${s.rank.kg}` : s.rank.noQty}
            </span>
          </p>
          <p className="text-xs text-gray-800 mt-1">{where}</p>
          {!done && (
            // Where a mould goes is the supervisor's answer; until he gives it,
            // where the shift log shows it has run stands in — and is said to
            // be only that (owner, 2026-10-07).
            <p className={`text-xs mt-0.5 ${fitAnswered ? "text-gray-500" : "text-amber-700"}`}>
              {fitAnswered ? fill(s.ordersTab.fits, { machines: codesText(o.fits!) })
                : o.ranOn.length > 0 ? fill(s.ordersTab.ranOn, { machines: codesText(o.ranOn) })
                : s.ordersTab.fitsAsk}
            </p>
          )}
          {!done && stockLine(o)}
          <div className="flex flex-wrap gap-1 mt-1.5">
            {!done && urgencyChips(o, data.today).map((c) => <Pill key={c.key} text={chipText(c)} tone={CHIP_TONE[c.tone]} />)}
            {o.status === "On Hold" && <Pill text={s.ordersTab.onHold} tone="gray" />}
          </div>
        </div>
        <Btn variant="ghost" onClick={() => setOrderForm(o)} disabled={!canWrite}><HelpCircle size={15} />{s.rank.questions}</Btn>
      </li>
    );
  };
  const sortedOrders = sortByUrgency(orders, data.today);
  const orderGroups = {
    waiting: sortedOrders.filter((o) => !o.doneByFloor && o.remaining !== 0 && !o.mountedRunning),
    running: sortedOrders.filter((o) => !o.doneByFloor && o.remaining !== 0 && o.mountedRunning),
    done: sortedOrders.filter((o) => !!o.doneByFloor || o.remaining === 0),
  };
  // A key client goes first only by its DATE (late, or due within a few
  // days): one of his orders with no date at all can never be urgent, and
  // nothing else on the page says so.
  const keyNoDate = orders.filter((o) => o.keyClient && !o.dueDate && !o.doneByFloor && o.remaining !== 0).length;

  return (
    <div dir={isAr ? "rtl" : "ltr"}>
      <GlyphDefs />
      <div className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-gray-900">{s.title}</h1>
          <button onClick={reload} className={iconBtnCls} title={s.refresh} aria-label={s.refresh} disabled={loading}>
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} /><span className="hidden sm:inline">{s.refresh}</span>
          </button>
        </div>
        <p className="text-sm text-gray-500 mt-1">{s.subtitle}</p>
      </div>

      {failed && (
        <LoadError className="mb-3" text={failed.timedOut ? p.common.timedOut : s.loadError} retry={p.common.retry} onRetry={reload} loading={loading} />
      )}
      {!live && (
        <p className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mb-3">{s.notLive}</p>
      )}
      {data.dataAgeMs > STALE_AFTER_MS && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
          {fill(s.dataAge, { age: ageLabel(data.dataAgeMs, isAr) })}
        </p>
      )}
      {quickError && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3" role="alert">{quickError}</p>}
      {(data.friday || data.dayOff) && (
        <p className="text-sm text-indigo-800 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 mb-3 flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />{data.friday ? s.friday : s.more.dayOff}
        </p>
      )}
      {data.logRead === false && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3 flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />{s.logDown}
        </p>
      )}

      {data.stoppagesRead === false && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3 flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />{s.stoppagesDown}
        </p>
      )}
      {/* The store is a warning on a card, not what the plan stands on: a
          quiet line. Without it, "nothing said about material" would read as
          "the material is there". */}
      {data.stockRead === false && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">{s.stockDown}</p>
      )}

      {!machine && (
        <>
          <div className="grid grid-cols-4 gap-2 mb-3">
            <StatTile label={s.summary.running} value={fmtInt(count("running"), isAr)} tone="green" />
            <StatTile label={s.summary.stopped} value={fmtInt(count("stopped"), isAr)} tone="red" />
            <StatTile label={s.summary.idle} value={fmtInt(count("idle"), isAr)} tone="amber" />
            <StatTile label={s.summary.waiting} value={fmtInt(waiting, isAr)} />
          </div>
          <div className="grid grid-cols-3 rounded-xl border border-gray-300 overflow-hidden mb-4" role="tablist">
            {(["floor", "day", "orders"] as const).map((v) => (
              <button
                key={v} type="button" role="tab" aria-selected={tab === v} onClick={() => setTab(v)}
                className={`min-h-12 px-1.5 text-sm font-semibold inline-flex items-center justify-center gap-1.5 ${tab === v ? "bg-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50 active:bg-gray-100"}`}
              >
                {v === "floor" ? <LayoutGrid size={15} /> : v === "day" ? <ListChecks size={15} /> : <List size={15} />}
                {s.tabs[v]}
                {v === "day" && needNow > 0 && (
                  <span className={`min-w-5 h-5 px-1 rounded-full text-xs leading-5 text-center tabular-nums ${tab === v ? "bg-white text-blue-700" : "bg-red-600 text-white"}`}>{fmtInt(needNow, isAr)}</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      {/* ------------------------------- the floor ------------------------------- */}
      {!machine && tab === "floor" && (
      <section className="mb-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden" role="group">
            {(["map", "list"] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
                className={`inline-flex items-center gap-1.5 min-h-11 sm:min-h-0 px-3 py-1.5 text-sm ${view === v ? "bg-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}>
                {v === "map" ? <LayoutGrid size={15} /> : <List size={15} />}{s.view[v]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {showMap && !arranging && (
              <Btn variant="outline" onClick={() => { wideByTurn.current = false; setWide(true); }}><Maximize2 size={14} />{s.map.full}</Btn>
            )}
            {data.writable && !arranging && (
              <Btn variant="outline" onClick={() => setArranging(true)} disabled={!canWrite}><Pencil size={14} />{s.map.edit}</Btn>
            )}
          </div>
        </div>

        {arranging ? (
          <ArrangeMap
            machines={machines} initial={layout} isAr={isAr} s={s} cancel={p.common.cancel}
            onClose={() => setArranging(false)} onSaved={async () => { setArranging(false); setView("map"); await reloadFresh(); }}
          />
        ) : (
          <>
            {view === "map" && layout.length === 0 && (
              <p className="text-sm text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mb-2">{s.map.empty}</p>
            )}

            {showMap ? (
              <>
                <Floor tiles={layout}>
                  {(fit) => fit.tiles.map((t) => { const m = machines.find((x) => machineKey(x.label) === machineKey(t.label)); return m ? tile(m, t, fit) : null; })}
                </Floor>
                {/* On a phone held upright the plan is wider than the screen. */}
                <p className="sm:hidden text-xs text-gray-500 mt-1.5">{s.map.turnPhone}</p>
                {wide && (
                  <FloorScreen
                    title={s.map.title} closeLabel={s.map.close} onClose={closeWide}
                    legend={STATES.map((st) => (
                      <span key={st} className="inline-flex items-center gap-1"><span className={`w-2.5 h-2.5 rounded-full ${STATE_DOT[st]}`} />{s.states[st]}</span>
                    ))}
                  >
                    <Floor tiles={layout} fill>
                      {(fit) => fit.tiles.map((t) => { const m = machines.find((x) => machineKey(x.label) === machineKey(t.label)); return m ? tile(m, t, fit, closeWide) : null; })}
                    </Floor>
                  </FloorScreen>
                )}
                {unplaced.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs text-gray-500 mb-1">{s.map.unplaced}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{unplaced.map(row)}</div>
                  </div>
                )}
              </>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">{machines.map(row)}</div>
            )}
          </>
        )}

        <p className="text-xs text-gray-500 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {STATES.map((st) => (
            <span key={st} className="inline-flex items-center gap-1"><span className={`w-2.5 h-2.5 rounded-full ${STATE_DOT[st]}`} />{s.states[st]}</span>
          ))}
          {data.logDate && <span>{fill(s.asOf, { date: formatDate(data.logDate, lang) })}</span>}
        </p>
        {/* Rule 4 hangs on an answer nobody is asked for anywhere else. */}
        {transparentMachines.length === 0 && (
          <p className="text-xs text-gray-500 mt-1">{s.hints.noTransparentMachine}</p>
        )}
        {/* …and what the log suggests, to be confirmed with one tap — never marked by itself. */}
        {transparentMachines.length === 0 && (data.transparentHint ?? []).length > 0 && (
          <div className="mt-2 text-sm text-blue-900 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0">{fill(s.more.transparentSuggest, { machines: ltr((data.transparentHint ?? []).map(codeOf).join(" · ")) })}</span>
            <Btn variant="outline" disabled={!canWrite || quick !== ""}
              onClick={() => quickSave("transparent", (data.transparentHint ?? []).map((label) => ({ kind: "machine", name: label, values: { transparentOnly: true } })))}>
              {quick === "transparent" ? s.more.saving : (data.transparentHint ?? []).length === 1 ? s.more.transparentMarkOne : s.more.transparentMark}
            </Btn>
          </div>
        )}
        {machines.every((m) => !m.bigMachine) && (
          <p className="text-xs text-gray-500 mt-1">{s.hints.noBigMachine}</p>
        )}
        {data.canSetKeyClient && data.keyClients === 0 && (
          <p className="text-xs text-gray-500 mt-1">{s.hints.noKeyClient}</p>
        )}
      </section>
      )}

      {/* ------------------------------ the day's plan ------------------------------ */}
      {!machine && tab === "day" && (
        <section className="mb-5">
          <p className="text-xs text-gray-500 mb-3">{s.day.intro} {s.more.teams}</p>
          {/* The urgent orders the plan could not put on any machine — above
              everything else, because each is a delivery about to be missed
              and no card below mentions it. */}
          {dayPlan.unplaced.length > 0 && (
            <div className="mb-5 bg-red-50 border border-red-300 rounded-xl p-3">
              <p className="text-sm font-bold text-red-800 flex items-start gap-2">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <span className="min-w-0">{s.day.unplaced.title} <span className="font-normal tabular-nums">({fmtInt(dayPlan.unplaced.length, isAr)})</span></span>
              </p>
              <p className="text-xs text-red-800/90 mt-1">{s.day.unplaced.intro}</p>
              <ul className="mt-2 divide-y divide-red-200 border-t border-red-200">
                {dayPlan.unplaced.map(({ order: o, why }) => {
                  // Where its mould is, when it is up somewhere: an order held on
                  // a stopped machine is "no machine" for THAT reason, and the
                  // page says which machine and why (lib/changeover.ts planDay).
                  const on = o.mountedOn ? machines.find((m) => machineKey(m.label) === machineKey(o.mountedOn)) : undefined;
                  return (
                    <li key={o.id} className="py-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-900 break-words">{o.product} <span className="text-xs font-normal text-gray-500" dir="ltr">{o.code}</span></p>
                        <p className="text-xs text-gray-600 mt-0.5">
                          {o.client && <>{o.client} · </>}
                          {o.dueDate ? <>{s.rank.due} <bdi dir="ltr">{formatDate(o.dueDate, lang)}</bdi></> : s.rank.noDue}
                        </p>
                        <p className="text-sm font-medium text-red-800 mt-1 break-words">
                          {why === "noMachine" ? s.day.unplaced.noMachine
                            : o.stock?.material ? fill(s.day.unplaced.noMaterial, { material: o.stock.material })
                            : s.day.unplaced.noMaterialPlain}
                          {/* A guessed material is said to be one — this is the
                              line that takes a late order off every machine. */}
                          {why === "noMaterial" && stockGuessNote(o) && <span className="font-normal text-amber-700"> · {stockGuessNote(o)}</span>}
                        </p>
                        {why === "noMachine" && on && (
                          <p className="text-xs text-gray-600 mt-0.5 break-words">
                            {fill(s.ordersTab.where.standing, { machine: ltr(codeOf(on.label)) })}
                            {on.stoppage && <> · {fill(s.day.need.stopped, { reason: reasonText(on) })}</>}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {urgencyChips(o, data.today).map((c) => <Pill key={c.key} text={chipText(c)} tone={CHIP_TONE[c.tone]} />)}
                        </div>
                      </div>
                      {/* The answers that would place it — which store material,
                          which machines — are one tap away, as on «الأوامر». */}
                      <Btn variant="ghost" onClick={() => setOrderForm(o)} disabled={!canWrite}><HelpCircle size={15} />{s.rank.questions}</Btn>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {day.length === 0 && <EmptyState text={s.day.empty} />}
          {DAY_GROUP_KEYS.map((g) => {
            const rows = day.filter((e) => inGroup(g, e.need));
            if (rows.length === 0) return null;
            return (
              <div key={g} className="mb-5">
                <h2 className="text-sm font-bold text-gray-900 mb-2">
                  {s.day.groups[g]} <span className="font-normal text-gray-400 tabular-nums">({fmtInt(rows.length, isAr)})</span>
                </h2>
                {g === "now" || g === "soon" ? (
                  <ul className="space-y-2">{rows.map((e, i) => dayCard(e, g === "now" ? i + 1 : undefined))}</ul>
                ) : (
                  // Machines with nothing to decide, one line each: the ones
                  // that are down (the reason, and since when — never a pick),
                  // and the ones that just keep running.
                  <ul className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
                    {rows.map((e) => {
                      const note = g === "running" && e.finishIn !== null ? forecastNote(e.current) : "";
                      return (
                        <li key={e.machine.label}>
                          <button type="button" onClick={() => pick(e.machine.label)}
                            className="w-full text-start px-3 py-2.5 min-h-11 flex flex-wrap items-center gap-x-2 hover:bg-gray-50 active:bg-gray-100">
                            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${STATE_DOT[e.machine.state]}`} />
                            <bdi dir="ltr" className="font-bold text-gray-900 whitespace-nowrap">{codeOf(e.machine.label)}</bdi>
                            {g === "down" ? (
                              <span className="min-w-0 flex-1 text-sm text-red-700 break-words">
                                {fill(s.day.need.down, { reason: reasonText(e.machine), since: stoppageSince(e.machine) })}
                                {stoppageFault(e.machine.stoppage?.reason) === "machine" && e.machine.now.products.length > 0 && (
                                  <span className="block text-xs text-emerald-700">
                                    {e.movesTo ? fill(s.more.mouldGoes, { machine: ltr(codeOf(e.movesTo)) }) : s.more.mouldGood}
                                  </span>
                                )}
                              </span>
                            ) : (
                              <>
                                <span className="min-w-0 flex-1 text-sm text-gray-700 truncate">{e.machine.now.products.join(" / ") || s.machines.empty}</span>
                                {e.finishIn !== null && <span className="text-xs text-gray-500 whitespace-nowrap">{fill(s.day.need.left, { t: roughly(e.finishIn) })}</span>}
                                {/* On a line of its own, the whole width: beside the name it was three lines of four words. */}
                                {note && <span className="basis-full ps-[18px] text-[11px] text-gray-500 break-words">{note}</span>}
                              </>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </section>
      )}

      {/* -------------------------------- the orders -------------------------------- */}
      {!machine && tab === "orders" && (
        <section className="mb-5">
          <p className="text-xs text-gray-500 mb-3">{s.ordersTab.intro}</p>
          {keyNoDate > 0 && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3 flex items-start gap-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span className="min-w-0">{fill(s.ordersTab.keyNoDate, { n: fmtInt(keyNoDate, isAr) })}</span>
            </p>
          )}
          {orders.length === 0 && <EmptyState text={s.ordersTab.none} />}
          {(["waiting", "running", "done"] as const).map((g) => orderGroups[g].length > 0 && (
            <div key={g} className="mb-5">
              <h2 className="text-sm font-bold text-gray-900 mb-2">
                {s.ordersTab.groups[g]} <span className="font-normal text-gray-400 tabular-nums">({fmtInt(orderGroups[g].length, isAr)})</span>
              </h2>
              <ul className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">{orderGroups[g].map(orderRow)}</ul>
            </div>
          ))}
        </section>
      )}

      {/* ---------------------------- the chosen machine ---------------------------- */}
      {machine && (
        <section ref={panelRef} className="scroll-mt-20">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Btn variant="outline" onClick={() => setSelected("")}>{isAr ? <ArrowRight size={15} /> : <ArrowLeft size={15} />}{s.screen.back}</Btn>
            <span className="text-lg font-bold text-gray-900 whitespace-nowrap" dir="ltr">{machine.label}</span>
            <Pill text={stateWord(machine)} tone={STATE_TONE[machine.state]} />
          </div>
          <div className="grid grid-cols-2 rounded-xl border border-gray-300 overflow-hidden mb-3" role="tablist">
            {(["now", "next"] as const).map((v) => (
              <button
                key={v} type="button" role="tab" aria-selected={mtab === v} onClick={() => setMtab(v)}
                className={`min-h-11 px-2 text-sm font-semibold ${mtab === v ? "bg-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50 active:bg-gray-100"}`}
              >
                {s.screen[v]}{v === "next" && plan.ranked.length > 0 && <span className="tabular-nums"> ({fmtInt(plan.ranked.length, isAr)})</span>}
              </button>
            ))}
          </div>
          {mtab === "now" && (
          <div className="bg-white border border-gray-200 rounded-xl p-3 sm:p-4 mb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-bold text-gray-900 whitespace-nowrap" dir="ltr">{machine.label}</span>
                  <Pill text={s.states[machine.state]} tone={STATE_TONE[machine.state]} />
                  {machine.transparentOnly && <Pill text={s.machines.transparentOnly} tone="blue" />}
                  {machine.bigMachine && <Pill text={s.machines.bigMachine} tone="gray" />}
                </p>
                <p className="text-xs text-gray-500 mt-2">{s.now.title}</p>
                <p className="font-semibold text-gray-900 break-words">
                  {machine.now.products.join(" / ") || <span className="font-normal text-gray-400">{s.machines.empty}</span>}
                </p>
              </div>
              <Btn variant="outline" onClick={() => setMachineForm(machine)} className="shrink-0" disabled={!canWrite}><Pencil size={14} />{s.now.edit}</Btn>
            </div>
            {machine.now.products.length > 0 && (() => {
              const o = orderOf(machine);
              return (
                <div className="text-sm text-gray-700 mt-2 space-y-1">
                  <p>
                    <ColourTags colours={machine.now.colours} isAr={isAr} s={s} guessed={machine.now.coloursGuessed} />
                    {machine.now.colours.length > 1 && (
                      <span className="text-gray-500"> ({machine.now.colourNow
                        ? fill(s.now.runningColour, { colour: colourName(machine.now.colourNow, isAr, s) })
                        : s.now.colourNowUnknown})</span>
                    )}
                    {" · "}{machine.now.material || <span className="text-amber-700">{s.now.noMaterial}</span>}
                  </p>
                  <p className="text-xs text-gray-500">
                    {o
                      ? <>{s.now.order} <span dir="ltr">{o.code}</span>{o.client && <> · {o.client}</>}{o.remaining !== null && <> · {fill(s.machines.left, { n: `${fmtInt(o.remaining, isAr)} ${s.rank.pieces}` })}</>}</>
                      : s.now.noOrder}
                    {machine.now.since && <> · {fill(machine.state === "idle" ? s.now.idleSince : s.now.lastShift, { date: formatDate(machine.now.since, lang) })}</>}
                    {" · "}{s.now.source[machine.now.source]}
                  </p>
                  {machine.stoppage && (
                    <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      <span className="font-medium">{stoppageText(machine)}</span>
                      <span className="block text-xs text-red-600/90 mt-0.5">{s.now.stoppageHint}</span>
                    </p>
                  )}
                  {/* The floor's word against the count (owner, 2026-10-07): the
                      page cannot tell which is wrong, so it says both — and
                      where each one is put right. */}
                  {o?.doneUnsure && (
                    <div className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      <p className="flex items-start gap-2"><AlertTriangle size={16} className="mt-0.5 shrink-0" /><span className="min-w-0">{unsureText(o)}</span></p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {(["orders", "downtime"] as const).map((k) => (
                          <Link key={k} href={k === "orders" ? "/dashboard/jobs" : "/dashboard/downtime"}
                            className="inline-flex items-center justify-center min-h-11 sm:min-h-0 px-4 py-2 rounded-lg border border-amber-300 bg-white text-sm font-medium text-amber-900 hover:bg-amber-100 active:bg-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40">
                            {s.unsure[k]}
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                  {machine.now.coloursGuessed && (
                    <p className="text-xs text-amber-700 flex items-start gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{s.now.coloursGuessed}</p>
                  )}
                  {/* The three things the log cannot settle — asked, never decided,
                      and each answered with one tap. */}
                  {machine.now.orderMaybe && (
                    <div className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      <p>{fill(s.ask.orderMaybe, { order: ltr(machine.now.orderMaybe), product: orders.find((x) => x.code === machine.now.orderMaybe)?.product ?? "" })}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Btn variant="outline" onClick={() => void noteNow(machine, { order: machine.now.orderMaybe })} disabled={!canWrite || tying}>{tying ? s.saving : s.ask.yes}</Btn>
                        <Btn variant="outline" onClick={() => void noteNow(machine, { order: "", noOrder: true })} disabled={!canWrite || tying}>{s.ask.no}</Btn>
                      </div>
                    </div>
                  )}
                  {machine.now.alsoOn && (
                    <div className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      <p>{fill(s.ask.alsoOn, { machine: ltr(machine.now.alsoOn) })}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Btn variant="outline" onClick={() => void noteNow(machine)} disabled={!canWrite || tying}>{tying ? s.saving : s.ask.stillHere}</Btn>
                      </div>
                    </div>
                  )}
                  {machine.now.mixedShift && (
                    <div className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      <p>{s.ask.mixedShift}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Btn variant="outline" disabled={!canWrite || tying}
                          // The order, the colours and a «لا» on record belong to the mould
                          // that came OFF — unless the order is the new mould's own.
                          onClick={() => void noteNow(machine, {
                            products: machine.now.products.slice(0, 1), fromProducts: machine.now.products.slice(1),
                            colours: [], colourNow: "", noOrder: false,
                            ...(o && fold(o.product) === fold(machine.now.products[0] ?? "") ? {} : { order: "" }),
                          })}>
                          {tying ? s.saving : fill(s.ask.changed, { product: machine.now.products[0] ?? "" })}
                        </Btn>
                        <Btn variant="outline" onClick={() => void noteNow(machine)} disabled={!canWrite || tying}>{s.ask.both}</Btn>
                      </div>
                    </div>
                  )}
                  {tieError && <p className="text-xs text-red-700" role="alert">{tieError}</p>}
                </div>
              );
            })()}
          </div>
          )}

          {mtab === "next" && (
          <>
          <h2 className="text-base font-bold text-gray-900 mb-2">{fill(s.rank.title, { machine: ltr(machine.label) })}</h2>
          {machine.state === "running" && plan.ranked.length > 0 && (
            <p className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mb-2">{s.rank.busyNote}</p>
          )}
          {/* The stoppage's reason decides whether the machine can take a mould
              (owner, 2026-10-07). The day's plan offers a machine that is down
              nothing; here the list stays — it is what goes on afterwards —
              and says so. A warning, never a block. */}
          {machine.stoppage && stoppageKind(machine.stoppage.reason) === "blocked" && plan.ranked.length > 0 && (
            <p className="text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-2">
              {fill(s.rank.downNote, { reason: reasonText(machine) })}
            </p>
          )}
          {plan.ranked.length === 0 && plan.blocked.length === 0 && (
            <EmptyState text={waiting === 0 ? s.rank.noOrders : s.rank.none} />
          )}

          <ol className="space-y-2">{plan.ranked.map(card)}</ol>

          {plan.blocked.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-1">{s.blocked.title}</h3>
              <ul className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
                {plan.blocked.map((b) => (
                  <li key={b.order.id} className="px-3 py-2.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block text-sm text-gray-900 break-words">{b.order.product} <span className="text-xs text-gray-400" dir="ltr">{b.order.code}</span></span>
                      <span className={`block text-xs mt-0.5 ${b.reason === "missing" ? "text-red-600" : "text-gray-500"}`}>
                        {b.reason === "missing"
                          ? fill(s.blocked.missing, { items: missingText(String(b.vars?.items ?? "")) })
                          : b.reason === "finished" || b.reason === "onHold" || b.reason === "doneByFloor"
                            ? s.blocked[b.reason]
                            : fill(s.blocked[b.reason], { machines: ltr(String(b.vars?.machines ?? "")) })}
                      </span>
                    </span>
                    <Btn variant="ghost" onClick={() => setOrderForm(b.order)} disabled={!canWrite}><HelpCircle size={15} />{s.rank.questions}</Btn>
                  </li>
                ))}
              </ul>
            </div>
          )}
          </>
          )}
        </section>
      )}

      {machineForm && (
        <MachineForm
          machine={machineForm} orders={orders} isAr={isAr} s={s} cancel={p.common.cancel}
          onClose={() => setMachineForm(null)} onSaved={async () => { setMachineForm(null); await reloadFresh(); }}
        />
      )}
      {orderForm && (
        <OrderForm
          order={orderForm} machines={machines} storeMaterials={data.storeMaterials} stockRead={data.stockRead}
          canSetKeyClient={data.canSetKeyClient} isAr={isAr} s={s} cancel={p.common.cancel}
          onClose={() => setOrderForm(null)} onSaved={async () => { setOrderForm(null); await reloadFresh(); }}
        />
      )}
      {confirm && (
        <ConfirmForm
          machine={confirm.machine} pick={confirm.pick} friday={data.friday || !!data.dayOff} canWrite={canWrite} isAr={isAr} s={s} cancel={p.common.cancel}
          minutes={minutes} reasons={confirm.pick.chips.map((c) => chipText(c, co.ar, true)).join(" · ")}
          onClose={() => setConfirm(null)}
          onDone={async (r) => { setConfirm(null); setDone(r); await reloadFresh(); }}
        />
      )}
      {done && done.ok && (
        <Modal open title={s.done.title} onClose={() => setDone(null)} isAr={isAr}>
          <ul className="space-y-2 text-sm text-gray-800">
            <li className="flex items-start gap-2"><Check size={16} className="mt-0.5 text-emerald-600 shrink-0" />{done.replay ? s.done.replay : s.done.log}</li>
            {done.started && <li className="flex items-start gap-2"><Check size={16} className="mt-0.5 text-emerald-600 shrink-0" />{s.done.started}</li>}
            {done.jobNote !== "baseline" && (["job", "registry"] as const).map((k) => {
              const outcome = done[k];
              const raw = k === "job" ? done.jobNote : done.registryNote;
              const note = (s.done.notes as Record<string, string>)[raw] ?? raw;
              const bad = outcome === "failed";
              return (
                <li key={k} className={`flex items-start gap-2 ${bad ? "text-red-700" : ""}`}>
                  {bad ? <AlertTriangle size={16} className="mt-0.5 shrink-0" /> : <Check size={16} className="mt-0.5 text-emerald-600 shrink-0" />}
                  {fill(s.done[k][outcome], { note })}
                </li>
              );
            })}
          </ul>
          <div className="mt-4 flex justify-end"><Btn onClick={() => setDone(null)}>{s.done.close}</Btn></div>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------ arranging the map ------------------------------ */

/**
 * The floor's editor, IN PLACE of the map and as wide as the page (owner,
 * 2026-10-06: "more landscape, and more pixels to move the machines" — it was
 * a narrow dialog over a 7-column grid). A machine is dragged to where it
 * stands and snaps to the sheet's units; its corner is dragged to size it; the
 * arrows move it one unit for the last touch. Tapping a machine in the tray
 * drops it on the first free spot. Saved as ONE cell of the answers tab, so
 * the floor plan is the owner's data, not the code's.
 */
function ArrangeMap({ machines, initial, isAr, s, cancel, onClose, onSaved }: {
  machines: PlanMachine[]; initial: MapTile[]; isAr: boolean; s: Strings; cancel: string;
  onClose: () => void; onSaved: () => Promise<void>;
}) {
  const [tiles, setTiles] = useState<MapTile[]>(initial);
  const [picked, setPicked] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sheet = useRef<HTMLDivElement>(null);
  // The grab: which machine, moving or sizing, and where on the tile it was caught.
  const drag = useRef<{ label: string; mode: "move" | "size"; dx: number; dy: number } | null>(null);

  // A quarter turn is lossy (edges are rounded), so every press turns the
  // arrangement the FIRST press started from; four presses are back at it.
  const turned = useRef<{ base: MapTile[]; n: number; out: MapTile[] } | null>(null);
  const turn = () => {
    const from = turned.current && turned.current.out === tiles ? turned.current : { base: tiles, n: 0, out: tiles };
    const n = (from.n + 1) % 4;
    const out = n === 0 ? from.base : turnLayout(from.base, n);
    turned.current = { base: from.base, n, out };
    setTiles(out); setPicked(""); setNote("");
  };

  const placedKeys = new Set(tiles.map((t) => machineKey(t.label)));
  const tray = machines.filter((m) => !placedKeys.has(machineKey(m.label)));
  const current = tiles.find((t) => machineKey(t.label) === machineKey(picked));

  /** A pointer, in the sheet's own units (fractions of a unit included). */
  const unitsAt = (e: { clientX: number; clientY: number }) => {
    const box = sheet.current!.getBoundingClientRect();
    return { x: (e.clientX - box.left) / (box.width / MAP_COLS), y: (e.clientY - box.top) / (box.height / MAP_MAX_ROWS) };
  };

  const put = (label: string, at: { c: number; r: number; w?: number; h?: number }) => {
    const next = placeTile(tiles, label, at);
    if (!next) { setNote(s.map.taken); return; }
    setTiles(next); setNote("");
  };
  const add = (label: string) => {
    const spot = freeSpot(tiles);
    if (!spot) { setNote(s.map.noRoom); return; }
    setPicked(label);
    put(label, spot);
  };
  const nudge = (dc: number, dr: number) => { if (current) put(current.label, { c: current.c + dc, r: current.r + dr }); };
  const resize = (dw: number, dh: number) => {
    if (current) put(current.label, { c: current.c, r: current.r, w: current.w + dw, h: current.h + dh });
  };

  // The drag is followed on the WINDOW, not through pointer capture on the
  // tile: capture throws for a pointer the browser no longer counts as active
  // (and killed the whole grab), and a finger that slides off the tile must
  // keep moving it. The latest tiles are read through a ref — the listeners
  // outlive the render that added them.
  const latest = useRef(tiles);
  useEffect(() => { latest.current = tiles; }, [tiles]);
  const stopDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => stopDrag.current?.(), []);

  const dragTo = (e: { clientX: number; clientY: number }) => {
    const d = drag.current;
    const now = latest.current;
    const t = d && now.find((x) => machineKey(x.label) === machineKey(d.label));
    if (!d || !t || !sheet.current) return;
    const at = unitsAt(e);
    const to = d.mode === "move"
      ? { c: Math.round(at.x - d.dx) + 1, r: Math.round(at.y - d.dy) + 1 }
      : { c: t.c, r: t.r, w: Math.round(at.x - (t.c - 1)), h: Math.round(at.y - (t.r - 1)) };
    const next = placeTile(now, d.label, to);
    // Onto another machine: it stays on its last good spot until it is clear.
    if (!next) { setNote(s.map.taken); return; }
    const n = next[next.length - 1];
    if (n.c !== t.c || n.r !== t.r || n.w !== t.w || n.h !== t.h) { latest.current = next; setTiles(next); }
    setNote("");
  };
  const grab = (t: MapTile, mode: "move" | "size") => (e: React.PointerEvent<HTMLElement>) => {
    if (busy) return;
    e.stopPropagation();
    stopDrag.current?.();
    const at = unitsAt(e);
    drag.current = { label: t.label, mode, dx: at.x - (t.c - 1), dy: at.y - (t.r - 1) };
    setPicked(t.label); setNote("");
    const move = (ev: PointerEvent) => dragTo(ev);
    const stop = () => {
      drag.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      stopDrag.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    stopDrag.current = stop;
  };

  /** A tap on the bare floor moves the selected machine there (its middle on the tap). */
  const tapFloor = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || !picked || busy) return;
    const at = unitsAt(e);
    const w = current?.w ?? MAP_TILE.w, h = current?.h ?? MAP_TILE.h;
    put(picked, { c: Math.round(at.x - w / 2) + 1, r: Math.round(at.y - h / 2) + 1 });
  };
  const keyMove = (e: React.KeyboardEvent, t: MapTile) => {
    const step: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const by = step[e.key];
    if (!by) return;
    e.preventDefault();
    setPicked(t.label);
    put(t.label, { c: t.c + by[0], r: t.r + by[1] });
  };

  async function save() {
    if (tiles.length === 0) { onClose(); return; }
    setBusy(true); setError("");
    const r = await post({ action: "answers", items: [{ kind: "map", name: MAP_NAME, values: { layout: tiles } }] });
    if (!r.ok) { setBusy(false); setError(errorText(s, r.reason)); return; }
    await onSaved();
  }

  const small = "min-h-11 min-w-11 px-3 inline-flex items-center justify-center rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100 disabled:opacity-40";
  return (
    <div className="bg-white border border-blue-200 rounded-2xl p-2 sm:p-3" dir={isAr ? "rtl" : "ltr"}>
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <p className="text-sm text-gray-700 min-w-0 flex-1 basis-64">{s.map.hint}</p>
        <Btn variant="outline" onClick={turn} disabled={busy || tiles.length < 2}><RotateCw size={14} />{s.map.turn}</Btn>
      </div>

      {tray.length > 0 && (
        <div className="mb-3">
          <p className="text-xs text-gray-500 mb-1">{s.map.unplaced} — {s.map.trayHint}</p>
          <div className="flex flex-wrap gap-1.5" dir="ltr">
            {tray.map((m) => (
              <button key={m.label} type="button" onClick={() => add(m.label)} disabled={busy}
                className="min-h-11 px-2.5 rounded-lg border border-gray-300 text-sm font-medium text-gray-800 hover:bg-gray-50 active:bg-gray-100">
                {codeOf(m.label)}
              </button>
            ))}
          </div>
        </div>
      )}

      <Floor tiles={tiles} whole sheetRef={sheet} onSheetClick={tapFloor}>
        {/* A STABLE order: placeTile moves the tile it placed to the end of the
            list, and React re-inserting the node mid-drag would drop the
            pointer capture — the machine would stop following the finger. */}
        {() => [...tiles].sort((a, b) => a.label.localeCompare(b.label)).map((t) => {
          const on = machineKey(t.label) === machineKey(picked);
          return (
            <div
              key={t.label} role="button" tabIndex={0} aria-pressed={on} aria-label={t.label}
              onPointerDown={grab(t, "move")}
              onKeyDown={(e) => keyMove(e, t)}
              style={{ gridColumn: `${t.c} / span ${t.w}`, gridRow: `${t.r} / span ${t.h}` }}
              className={`relative m-[2px] min-w-0 min-h-0 flex items-center justify-center rounded-lg border-2 font-bold overflow-hidden select-none touch-none cursor-grab active:cursor-grabbing text-[12px] leading-tight text-center sm:text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${
                on ? "border-blue-600 bg-blue-600 text-white shadow-md z-10" : "border-slate-400 bg-white text-gray-900"
              }`}
            >
              {codeOf(t.label)}
              {on && (
                <span
                  role="presentation" title={s.map.resize}
                  onPointerDown={grab(t, "size")}
                  className="absolute bottom-0 right-0 w-6 h-6 sm:w-5 sm:h-5 cursor-nwse-resize touch-none rounded-tl-md bg-white/90 border-t-2 border-l-2 border-blue-600"
                />
              )}
            </div>
          );
        })}
      </Floor>

      <div className="mt-3 min-h-[3.25rem]">
        {current ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium text-gray-900 me-1">{fill(s.map.picked, { machine: ltr(current.label) })}</span>
            <span className="inline-flex gap-1" dir="ltr">
              <button type="button" className={small} onClick={() => nudge(-1, 0)} aria-label={s.map.left} title={s.map.left}><ArrowLeft size={16} /></button>
              <button type="button" className={small} onClick={() => nudge(0, -1)} aria-label={s.map.up} title={s.map.up}><ArrowUp size={16} /></button>
              <button type="button" className={small} onClick={() => nudge(0, 1)} aria-label={s.map.down} title={s.map.down}><ArrowDown size={16} /></button>
              <button type="button" className={small} onClick={() => nudge(1, 0)} aria-label={s.map.right} title={s.map.right}><ArrowRight size={16} /></button>
            </span>
            <button type="button" className={small} onClick={() => resize(1, 0)}>{s.map.wider}</button>
            <button type="button" className={small} disabled={current.w <= MAP_TILE.minW} onClick={() => resize(-1, 0)}>{s.map.narrower}</button>
            <button type="button" className={small} onClick={() => resize(0, 1)}>{s.map.taller}</button>
            <button type="button" className={small} disabled={current.h <= MAP_TILE.minH} onClick={() => resize(0, -1)}>{s.map.shorter}</button>
            <button type="button" className={`${small} text-red-700 border-red-200`} onClick={() => { setTiles(removeTile(tiles, current.label)); setPicked(""); setNote(""); }}>{s.map.remove}</button>
          </div>
        ) : null}
        {note && <p className="text-sm text-amber-700 mt-2" role="status">{note}</p>}
      </div>

      {error && <p className="text-sm text-red-700 mt-2" role="alert">{error}</p>}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Btn variant="ghost" onClick={onClose} disabled={busy}>{cancel}</Btn>
        <Btn onClick={save} disabled={busy || tiles.length === 0}>{busy ? s.saving : s.map.save}</Btn>
      </div>
    </div>
  );
}

/* --------------------------- «الراكب الآن» + the machine --------------------------- */

/** Pick ONE colour out of a few (or out of the whole list when `from` is not given). */
function OneColour({ from, value, onChange, isAr, s, none }: {
  from?: readonly string[]; value: string; onChange: (key: string) => void; isAr: boolean; s: Strings; none?: string;
}) {
  const keys = from ?? COLOURS.map((c) => c.key);
  return (
    <div className="flex flex-wrap gap-2">
      {keys.map((k) => (
        <button key={k} type="button" aria-pressed={value === k} className={chipCls(value === k)} onClick={() => onChange(k)}>
          <Swatch colour={k} />{colourName(k, isAr, s)}
        </button>
      ))}
      {none && (
        <button type="button" aria-pressed={value === ""} className={chipCls(value === "")} onClick={() => onChange("")}>{none}</button>
      )}
    </div>
  );
}

function MachineForm({ machine, orders, isAr, s, cancel, onClose, onSaved }: {
  machine: PlanMachine; orders: PlanOrder[]; isAr: boolean; s: Strings; cancel: string;
  onClose: () => void; onSaved: () => Promise<void>;
}) {
  const now = machine.now;
  const here = now.order ? orders.find((o) => o.code === now.order) ?? null : null;
  // An order RUNNING on another machine cannot also be standing on this one.
  const choices = orders.filter((o) => o === here || !(o.mountedOn && o.mountedRunning && machineKey(o.mountedOn) !== machineKey(machine.label)));
  const [mode, setMode] = useState<"order" | "product">(here ? "order" : "product");
  const [orderId, setOrderId] = useState(here?.id ?? "");
  const [product, setProduct] = useState(now.products.join(" | "));
  const [colours, setColours] = useState<string[]>(now.colours);
  const [colourNow, setColourNow] = useState(now.colourNow);
  const [jobTouched, setJobTouched] = useState(false);
  const [transparentOnly, setTransparentOnly] = useState(machine.transparentOnly);
  const [bigMachine, setBigMachine] = useState(machine.bigMachine);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // A different job is a different set of colours: the standing job's must
  // not ride along and be saved as the new one's.
  const newJob = (next: string[]) => { setJobTouched(true); setColours(next); setColourNow(""); };

  const picked = choices.find((o) => o.id === orderId) ?? null;
  const products = mode === "order"
    ? (picked ? [picked.product] : [])
    : product.split("|").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
  const order = mode === "order" && picked && !picked.code.startsWith("#") ? picked.code : "";
  const hereCode = here && !here.code.startsWith("#") ? here.code : "";
  // An order names ONE product; on a machine running a pair that is not a
  // change of job, and must not append a row on every save.
  const jobChanged = products.length > 0 && (order !== hereCode || (mode === "order"
    ? !now.products.some((x) => fold(x) === fold(products[0]))
    : !sameList(products, now.products)));
  // Colours are saved when they were changed — or when a guess is being
  // confirmed (the form says it is a guess, below).
  const coloursChanged = colours.length > 0 && (jobTouched || !sameList(colours, now.colours) || now.coloursGuessed);
  // The colour in the barrel: the only one there is, else the one tapped.
  const nowKey = colours.length === 1 ? colours[0] : colours.includes(colourNow) ? colourNow : "";
  const nowChanged = nowKey !== (jobTouched ? "" : now.colourNow);
  // What the engineer took OUT of the product box came off the machine.
  const removed = mode === "product" ? now.products.filter((x) => !products.some((y) => fold(y) === fold(x))) : [];
  const settings: Record<string, boolean> = {};
  if (transparentOnly !== machine.transparentOnly) settings.transparentOnly = transparentOnly;
  if (bigMachine !== machine.bigMachine) settings.bigMachine = bigMachine;
  const settingsChanged = Object.keys(settings).length > 0;

  async function save() {
    if (busy) return;
    // Where the colours live: on the work order when there is one (the order
    // decides the colour — the owner's rule), else with the mould on the
    // machine. The colour in the barrel is always the machine's own row.
    const items: { kind: string; name: string; values: Record<string, unknown> }[] = [];
    if (settingsChanged) items.push({ kind: "machine", name: machine.label, values: settings });
    if (order && coloursChanged) items.push({ kind: "order", name: order, values: { colour: colours } });
    // …and a barrel colour shown as selected beside a colour list that changed
    // is saved with it (it was derived, not stored, while there was one colour).
    const needRow = products.length > 0
      && (jobChanged || (!order && coloursChanged) || nowChanged || (!!nowKey && colours.length > 1 && coloursChanged));
    if (products.length === 0 && !settingsChanged) { setError(s.errors.no_product); return; }
    if (items.length === 0 && !needRow) { onClose(); return; }

    setBusy(true); setError("");
    if (items.length > 0) {
      const r = await post({ action: "answers", items });
      if (!r.ok) { setBusy(false); setError(errorText(s, r.reason)); return; }
    }
    if (needRow) {
      const r = await post({
        action: "mount", baseline: true, machine: machine.label, order,
        // An order names ONE product; a machine recorded as a pair stays a pair.
        // …and while the mixed-shift question is open, an untouched box (it is
        // pre-filled with BOTH moulds) must not answer it as "both stand".
        products: mode === "order" && !jobChanged && !now.mixedShift
          ? [products[0], ...now.products.filter((x) => fold(x) !== fold(products[0]))]
          : mode === "product" && now.mixedShift && sameList(products, now.products) ? products.slice(0, 1)
          : products,
        colours, colourNow: nowKey,
        // A «لا» already given about this mould is kept by a note about its colours.
        noOrder: !order && now.noOrder && !jobChanged,
        fromProducts: removed, fromColours: [],
      });
      if (!r.ok) { setBusy(false); setError(errorText(s, r.reason)); return; }
    }
    await onSaved();
  }

  const toggle = (label: string, value: boolean, set: (v: boolean) => void) => (
    <label className="flex items-center gap-3 min-h-11 text-sm text-gray-800 cursor-pointer">
      <input type="checkbox" className="w-5 h-5 shrink-0" checked={value} onChange={(e) => set(e.target.checked)} />{label}
    </label>
  );

  return (
    <Modal open title={fill(s.machineForm.title, { machine: ltr(machine.label) })} onClose={onClose} isAr={isAr}>
      <p className="text-sm font-medium text-gray-900 mb-2">{s.machineForm.what}</p>
      <div className="flex gap-2 mb-3">
        <button type="button" className={`flex-1 ${chipCls(mode === "order")}`} aria-pressed={mode === "order"}
          onClick={() => { if (mode !== "order") { setMode("order"); newJob(picked ? picked.colours.filter((c) => c !== ANY_COLOUR) : []); } }}>
          {s.machineForm.order}
        </button>
        <button type="button" className={`flex-1 ${chipCls(mode === "product")}`} aria-pressed={mode === "product"}
          onClick={() => { if (mode !== "product") { setMode("product"); newJob([]); } }}>
          {s.machineForm.noOrder}
        </button>
      </div>
      {mode === "order" ? (
        <select
          className={inputCls} value={orderId} aria-label={s.machineForm.order}
          onChange={(e) => {
            setOrderId(e.target.value);
            const o = choices.find((x) => x.id === e.target.value);
            newJob(o ? o.colours.filter((c) => c !== ANY_COLOUR) : []);
          }}
        >
          <option value="">—</option>
          {choices.map((o) => <option key={o.id} value={o.id}>{o.code} — {o.product}</option>)}
        </select>
      ) : (
        <>
          <input className={inputCls} value={product} aria-label={s.machineForm.product} placeholder={s.machineForm.product}
            maxLength={300}
            // Correcting a name must not wipe the colours tapped a moment ago
            // (they sit under the keyboard on a phone); an EMPTIED box is a new job.
            onChange={(e) => { setProduct(e.target.value); if (e.target.value.trim() === "" && !jobTouched) newJob([]); }} />
          <p className="text-xs text-gray-400 mt-1">{s.machineForm.productHint}</p>
        </>
      )}

      <p className="text-sm font-medium text-gray-900 mt-4">{s.machineForm.colour}</p>
      <p className="text-xs text-gray-500 mb-2">{s.colours.many}</p>
      {/* A guess left pressed and saved becomes the answer — the standing job's, or the picked order's. */}
      {(jobTouched
        ? mode === "order" && picked?.colourSource === "guess" && sameList(colours, picked.colours.filter((c) => c !== ANY_COLOUR))
        : now.coloursGuessed) && colours.length > 0 && <p className="text-sm text-amber-700 mb-2">{s.confirm.colourGuess}</p>}
      <ColourPicker value={colours} onChange={(next) => { setColours(next); if (!next.includes(colourNow)) setColourNow(""); }} isAr={isAr} s={s} />

      {colours.length > 1 && (
        <>
          <p className="text-sm font-medium text-gray-900 mt-4">{s.machineForm.colourNow}</p>
          <p className="text-xs text-gray-500 mb-2">{s.machineForm.colourNowHint}</p>
          <OneColour from={colours} value={nowKey} onChange={setColourNow} isAr={isAr} s={s} none={s.confirm.barrelUnknown} />
        </>
      )}

      <p className="text-sm font-medium text-gray-900 mt-5 mb-1">{s.machineForm.settings}</p>
      {toggle(s.machineForm.transparentOnly, transparentOnly, setTransparentOnly)}
      {toggle(s.machineForm.bigMachine, bigMachine, setBigMachine)}

      <p className="text-xs text-gray-500 mt-3">{s.machineForm.onlyRecords}</p>
      {error && <p className="text-sm text-red-700 mt-2" role="alert">{error}</p>}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Btn variant="ghost" onClick={onClose} disabled={busy}>{cancel}</Btn>
        <Btn onClick={save} disabled={busy}>{busy ? s.saving : s.machineForm.save}</Btn>
      </div>
    </Modal>
  );
}

/* ------------------------------- the questions ------------------------------- */

function OrderForm({ order, machines, storeMaterials, stockRead, canSetKeyClient, isAr, s, cancel, onClose, onSaved }: {
  order: PlanOrder; machines: PlanMachine[]; storeMaterials: readonly string[]; stockRead: boolean;
  canSetKeyClient: boolean; isAr: boolean; s: Strings; cancel: string;
  onClose: () => void; onSaved: () => Promise<void>;
}) {
  const [colours, setColours] = useState<string[]>(order.colours);
  const [fits, setFits] = useState<string[]>(order.fits ?? []);
  const [workers, setWorkers] = useState<number | null>(order.workers);
  const [oilCores, setOilCores] = useState<boolean | null>(order.oilCores);
  const [hotRunner, setHotRunner] = useState<boolean | null>(order.hotRunner);
  // Which material of «مخزن اتقان» the product is made of — asked once per
  // mould and remembered, because Master's material names do not match the
  // store's (owner, 2026-10-07). `order.storeMaterial` is the standing answer
  // ("" = never asked; a snapshot from before the field has none either) and
  // `stock.material` the store's own spelling of it, or of a guess. The answer
  // is read on its OWN: `stock` is null whenever the store cannot put a number
  // on it (the name gone from the store, its books below zero), and the form
  // then said «غير محددة» for an answered mould — every save added a row.
  const answeredMaterial = order.storeMaterial || "";
  const materialGuessed = !answeredMaterial && !!order.stock?.guessed;
  const stockMaterial = order.stock?.material || answeredMaterial;
  const [storeMaterial, setStoreMaterial] = useState(stockMaterial);
  const [missing, setMissing] = useState<MissingKey[] | null>(order.missing);
  const [keyClient, setKeyClient] = useState(order.keyClient);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The answers about THIS order are keyed on its code; a row with no code
  // has nothing to key them on, and saying so beats dropping them silently.
  const noCode = order.code.startsWith("#");
  // Where the shift log shows this mould has run, in the registry's own
  // spelling, most shifts first — offered as the answer, never taken as it.
  const ran = order.ranOn
    .map((l) => machines.find((m) => machineKey(m.label) === machineKey(l))?.label ?? "")
    .filter((l, i, all) => !!l && all.indexOf(l) === i);
  const ranTicked = sameList(fits.map(machineKey), ran.map(machineKey));
  // The answered material stays in the list even if the store no longer holds a line of it.
  const materialChoices = stockMaterial && !storeMaterials.includes(stockMaterial) ? [stockMaterial, ...storeMaterials] : storeMaterials;

  async function save() {
    if (busy) return;
    const orderValues: Record<string, unknown> = {};
    // A guess that is left selected and saved becomes the answer.
    if (colours.length > 0 && (order.colourSource !== "answer" || !sameList(colours, order.colours))) orderValues.colour = colours;
    if (missing !== null && (order.missing === null || !sameList(missing, order.missing))) orderValues.missing = missing;
    const moldValues: Record<string, unknown> = {};
    // An empty list is sent too: un-tapping every machine takes the answer back.
    if (!sameList(fits, order.fits ?? [])) moldValues.fits = fits;
    if (workers !== null && workers !== order.workers) moldValues.workers = workers;
    if (oilCores !== null && oilCores !== order.oilCores) moldValues.oilCores = oilCores;
    if (hotRunner !== null && hotRunner !== order.hotRunner) moldValues.hotRunner = hotRunner;
    // «غير محددة» is not an answer and sends nothing. A guess left selected
    // and saved becomes the answer — the form names it as a guess, below.
    if (stockRead && storeMaterial && (storeMaterial !== stockMaterial || materialGuessed)) moldValues.storeMaterial = storeMaterial;

    const items: { kind: string; name: string; values: Record<string, unknown> }[] = [];
    if (Object.keys(orderValues).length > 0 && !noCode) items.push({ kind: "order", name: order.code, values: orderValues });
    if (Object.keys(moldValues).length > 0) items.push({ kind: "mold", name: order.product, values: moldValues });
    if (canSetKeyClient && order.client && keyClient !== order.keyClient) items.push({ kind: "client", name: order.client, values: { keyClient } });
    // An answered colour cannot be taken back to nothing: say so rather than
    // close as if the empty picker had been saved.
    if (!noCode && colours.length === 0 && order.colourSource === "answer") { setError(s.confirm.colourNeeded); return; }
    if (items.length === 0) { onClose(); return; }

    setBusy(true); setError("");
    const r = await post({ action: "answers", items });
    if (!r.ok) { setBusy(false); setError(errorText(s, r.reason)); return; }
    await onSaved();
  }

  const q = "text-sm font-medium text-gray-900 mt-5 mb-2 first:mt-0";
  const yesNoRow = (value: boolean | null, set: (v: boolean) => void) => (
    <div className="flex flex-wrap gap-2">
      <button type="button" aria-pressed={value === true} className={chipCls(value === true)} onClick={() => set(true)}>{s.orderForm.yes}</button>
      <button type="button" aria-pressed={value === false} className={chipCls(value === false)} onClick={() => set(false)}>{s.orderForm.no}</button>
    </div>
  );
  return (
    <Modal open title={fill(s.orderForm.title, { product: order.product })} onClose={onClose} isAr={isAr}>
      {noCode ? (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{s.orderForm.noCode}</p>
      ) : (
        <>
          <p className={q}>{s.orderForm.colour}</p>
          <p className="text-xs text-gray-500 -mt-1 mb-2">{s.colours.many}</p>
          {/* A guess left pressed and saved becomes the answer — so it is named. */}
          {order.colourSource === "guess" && sameList(colours, order.colours) && <p className="text-sm text-amber-700 mb-2">{s.confirm.colourGuess}</p>}
          <ColourPicker value={colours} onChange={setColours} isAr={isAr} s={s} allowAny />
        </>
      )}

      <p className={q}>{s.orderForm.fits}</p>
      {order.fitsHintText && <p className="text-xs text-gray-500 -mt-1 mb-2">{fill(s.orderForm.fitsHint, { t: order.fitsHintText })}</p>}
      {/* Where a mould goes is learned from where it has run (owner,
          2026-10-07) — one tap ticks exactly those machines, and it is still
          the supervisor who saves the answer. */}
      {ran.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 -mt-1 mb-2">
          <p className="text-xs text-gray-600 min-w-0">{fill(s.orderForm.ranOn, { machines: codesText(ran) })}</p>
          {!ranTicked && <Btn variant="outline" onClick={() => setFits(ran)}>{s.orderForm.ranOnPick}</Btn>}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {machines.map((m) => {
          const on = fits.some((l) => machineKey(l) === machineKey(m.label));
          return (
            <button key={m.label} type="button" dir="ltr" aria-pressed={on} className={chipCls(on)}
              onClick={() => setFits(on ? fits.filter((l) => machineKey(l) !== machineKey(m.label)) : [...fits, m.label])}>
              {m.label}
            </button>
          );
        })}
      </div>

      <p className={q}>{s.orderForm.workers}</p>
      <div className="flex flex-wrap gap-2">
        {[1, 2, 3].map((n) => (
          <button key={n} type="button" aria-pressed={workers === n} className={`${chipCls(workers === n)} min-w-11 tabular-nums`} onClick={() => setWorkers(n)}>{n}</button>
        ))}
      </div>

      <p className={q}>{s.orderForm.oilCores}</p>
      {yesNoRow(oilCores, setOilCores)}

      <p className={q}>{s.orderForm.hotRunner}</p>
      {yesNoRow(hotRunner, setHotRunner)}

      <p className={q}>{s.orderForm.storeMaterial}</p>
      {!stockRead ? (
        // Not "no material": the store did not answer, and nothing can be picked from it.
        <p className="text-xs text-gray-500">{s.orderForm.storeDown}</p>
      ) : (
        <>
          <select className={inputCls} value={storeMaterial} aria-label={s.orderForm.storeMaterial} onChange={(e) => setStoreMaterial(e.target.value)}>
            {/* An answer is corrected by picking another material; it cannot
                be taken back to nothing (the latest non-blank cell stands), so
                «غير محددة» is offered only while nobody has answered. */}
            {(!stockMaterial || materialGuessed) && <option value="">{s.orderForm.storeMaterialNone}</option>}
            {materialChoices.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          {materialGuessed && storeMaterial === stockMaterial && (
            <p className="text-sm text-amber-700 mt-2">{fill(s.orderForm.storeMaterialGuess, { material: stockMaterial })}</p>
          )}
        </>
      )}

      {!noCode && (
        <>
          <p className={q}>{s.orderForm.missing}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={missing !== null && missing.length === 0} className={chipCls(missing !== null && missing.length === 0, "green")}
              onClick={() => setMissing([])}>
              {s.orderForm.nothingMissing}
            </button>
            {MISSING_ITEMS.map((it) => {
              const on = !!missing && missing.includes(it.key);
              return (
                <button key={it.key} type="button" aria-pressed={on} className={chipCls(on, "red")}
                  onClick={() => setMissing(on ? (missing ?? []).filter((k) => k !== it.key) : [...(missing ?? []), it.key])}>
                  {isAr ? it.ar : it.en}
                </button>
              );
            })}
          </div>
        </>
      )}

      {order.client && (
        <label className={`flex items-center gap-3 min-h-11 text-sm mt-5 ${canSetKeyClient ? "text-gray-800 cursor-pointer" : "text-gray-500"}`}>
          <input type="checkbox" className="w-5 h-5 shrink-0" checked={keyClient} disabled={!canSetKeyClient} onChange={(e) => setKeyClient(e.target.checked)} />
          <span>
            {fill(s.orderForm.keyClient, { client: order.client })}
            {!canSetKeyClient && <span className="block text-xs text-gray-400">{s.orderForm.keyClientOwner}</span>}
          </span>
        </label>
      )}

      {error && <p className="text-sm text-red-700 mt-3" role="alert">{error}</p>}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Btn variant="ghost" onClick={onClose} disabled={busy}>{cancel}</Btn>
        <Btn onClick={save} disabled={busy}>{busy ? s.saving : s.orderForm.save}</Btn>
      </div>
    </Modal>
  );
}

/* --------------------------------- «ركّب دي» --------------------------------- */

function ConfirmForm({ machine, pick, friday, canWrite, isAr, s, cancel, minutes, reasons, onClose, onDone }: {
  machine: PlanMachine; pick: Suggestion; friday: boolean; canWrite: boolean; isAr: boolean; s: Strings; cancel: string;
  minutes: (min: number) => string; reasons: string;
  onClose: () => void; onDone: (r: MountResult) => Promise<void>;
}) {
  const o = pick.order;
  const [colours, setColours] = useState<string[]>(o.colours);
  const [start, setStart] = useState(pick.startColour);
  const [barrelNow, setBarrelNow] = useState("");
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Something REAL goes into the barrel: «أي لون» is an order's indifference,
  // not a colour, so with it (or with no colour at all) the engineer says
  // which one he is starting on.
  const real = colours.filter((c) => c !== ANY_COLOUR);
  // (`start` is seeded with the suggestion; with the picker EMPTIED it must
  // not survive — the mount would record a colour the engineer just removed.)
  const startColour = real.length === 1 ? real[0] : real.includes(start) || (real.length === 0 && colours.length > 0 && start) ? start : "";
  // What is in the machine now: known, or asked here, or every colour its job
  // runs in — and then the estimate is the worst of them. A machine kept for
  // transparent with nothing recorded is taken to hold transparent.
  const barrel = barrelOf(machine);
  const fromColours = barrelNow && barrel.includes(barrelNow) ? [barrelNow] : barrel;
  const standing = machine.now.products.find((x) => x === o.product) ?? machine.now.products[0] ?? "";
  const est = useMemo(() => estimateFrom(
    { product: standing, colours: fromColours, material: machine.now.material },
    { product: o.product, colour: startColour, material: o.material },
    // The machine's own measured change time, as the ranking priced it: the
    // minutes confirmed here are the ones the card showed.
    { bigMachine: machine.bigMachine, oilCores: o.oilCores, hotRunner: o.hotRunner, swapMin: machine.swapMin },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [machine, o, standing, startColour, fromColours.join("|")]);
  const checks: readonly string[] = o.hotRunner ? [...CHECKS, "hotRunner"] : CHECKS;
  const allTicked = checks.every((k) => ticks[k]);
  const ready = allTicked && !!startColour;
  // The warning follows the RANKING's own word (Suggestion.interrupt: an urgent
  // key-client order, a late one or one that will be late — and never over a
  // job that ends within a shift, is itself late or a key client's, or went on
  // today). It had a rule of its own, "only for a key client": the plan said
  // «يستاهل نفك الشغال» and this dialog then said it was not allowed — and for
  // a key client with weeks to go, or over a mould mounted today, it said nothing.
  const interrupting = machine.state === "running" && !pick.interrupt && !o.queuedBehind;

  async function go() {
    if (!ready || busy) return;
    setBusy(true); setError("");
    const hasCode = !o.code.startsWith("#");
    // Colours confirmed here are the order's answer: a guess stops being one.
    if (hasCode && colours.length > 0 && (o.colourSource !== "answer" || !sameList(colours, o.colours))) {
      const a = await post({ action: "answers", items: [{ kind: "order", name: o.code, values: { colour: colours } }] });
      if (!a.ok) { setBusy(false); setError(errorText(s, a.reason)); return; }
    }
    const r = await post({
      action: "mount", machine: machine.label, order: hasCode ? o.code : "",
      products: [o.product], colours: real.length > 0 ? real : [startColour], colourNow: startColour,
      fromProducts: machine.now.products, fromColours,
      minutes: est.totalMin, reasons,
    });
    if (!r.ok) { setBusy(false); setError(errorText(s, r.reason)); return; }
    await onDone(r as unknown as MountResult);
  }

  return (
    <Modal open title={fill(s.confirm.title, { machine: ltr(machine.label) })} onClose={onClose} isAr={isAr}>
      <dl className="text-sm space-y-1.5">
        <div className="flex gap-2">
          <dt className="text-gray-500 shrink-0 w-16">{s.confirm.from}</dt>
          <dd className="text-gray-900 min-w-0 break-words">
            {machine.now.products.length > 0
              ? <>{machine.now.products.join(" / ")} · <ColourTags colours={machine.now.colours} isAr={isAr} s={s} guessed={machine.now.coloursGuessed} /></>
              : <span className="text-gray-400">{s.confirm.nothingOn}</span>}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-gray-500 shrink-0 w-16">{s.confirm.to}</dt>
          <dd className="text-gray-900 font-medium min-w-0 break-words">
            {o.product} <span className="text-gray-400 font-normal" dir="ltr">({o.code})</span>
          </dd>
        </div>
      </dl>

      {interrupting && (
        <p className="mt-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />{s.confirm.runningWarn}
        </p>
      )}

      {/* The order's colours: asked when there are none, and shown for
          confirming when they are only a guess — a guess is never written
          down as the answer without the engineer having seen it. */}
      {o.colourSource !== "answer" ? (
        <div className="mt-3">
          <p className="text-sm text-amber-700 mb-2">{colours.length === 0 ? s.confirm.colourNeeded : s.confirm.colourGuess}</p>
          <ColourPicker value={colours} onChange={setColours} isAr={isAr} s={s} allowAny />
        </div>
      ) : (
        <p className="text-sm text-gray-700 mt-2"><ColourTags colours={colours} isAr={isAr} s={s} /></p>
      )}
      {real.length !== 1 && colours.length > 0 && (
        <div className="mt-3">
          <p className="text-sm font-medium text-gray-900 mb-2">{real.length === 0 ? s.confirm.startAny : s.confirm.startColour}</p>
          <OneColour from={real.length === 0 ? undefined : real} value={startColour} onChange={setStart} isAr={isAr} s={s} />
        </div>
      )}
      {barrel.length > 1 && (
        <div className="mt-3">
          <p className="text-sm font-medium text-gray-900 mb-2">{s.confirm.barrelNow}</p>
          <OneColour from={barrel} value={barrelNow} onChange={setBarrelNow} isAr={isAr} s={s} none={s.confirm.barrelUnknown} />
        </div>
      )}

      <div className="mt-3 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 tabular-nums">
        <p>{s.rank.mould}: {est.sameMould ? s.rank.sameMould : `${s.approx} ${minutes(est.swapMin)}`}</p>
        {est.swapMeasured && !est.sameMould && (
          <p className="text-[11px] text-gray-500">{fill(s.rank.swapMeasured, { n: fmtInt(machine.swapSamples, isAr) })}</p>
        )}
        <p>{s.rank.purge}: {s.approx} {minutes(est.purgeMin)}</p>
        {est.hotRunnerMin > 0 && <p>{s.rank.hotRunner}: {s.approx} {minutes(est.hotRunnerMin)}</p>}
        {est.drying && (
          <p className="text-amber-700">
            {fill(s.chips.drying, { h: est.drying.minH === est.drying.maxH ? `${est.drying.minH}` : `${est.drying.minH}–${est.drying.maxH}` })}
          </p>
        )}
      </div>

      {friday && (
        <p className="mt-3 text-sm text-indigo-800 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />{s.confirm.fridayWarn}
        </p>
      )}

      <p className="text-sm font-medium text-gray-900 mt-4 mb-1">{s.confirm.checklist}</p>
      {checks.map((k) => (
        <label key={k} className="flex items-start gap-3 min-h-11 py-1.5 text-sm text-gray-800 cursor-pointer">
          <input type="checkbox" className="w-5 h-5 mt-0.5 shrink-0" checked={!!ticks[k]} onChange={(e) => setTicks({ ...ticks, [k]: e.target.checked })} />
          {(s.confirm.checks as Record<string, string>)[k]}
        </label>
      ))}

      <p className="text-xs text-gray-500 mt-3">{s.confirm.writes}</p>
      {!ready && <p className="text-xs text-amber-700 mt-1">{!startColour ? s.confirm.colourNeeded : s.confirm.tickAll}</p>}
      {!canWrite && <p className="text-xs text-amber-700 mt-1">{s.notLive}</p>}
      {error && <p className="text-sm text-red-700 mt-2" role="alert">{error}</p>}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Btn variant="ghost" onClick={onClose} disabled={busy}>{cancel}</Btn>
        <Btn onClick={go} disabled={busy || !ready || !canWrite}>{busy ? s.saving : s.confirm.go}</Btn>
      </div>
    </Modal>
  );
}
