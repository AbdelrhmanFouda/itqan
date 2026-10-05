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
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "@/context/LangContext";
import { authedFetch } from "@/lib/authed-fetch";
import { co } from "@/lib/i18n.changeover";
import { pd } from "@/lib/i18n.prod";
import { formatDate } from "@/lib/dates";
import { ageLabel, fill, fmtInt } from "@/lib/format";
import { type Tone } from "@/lib/prod-meta";
import {
  ANY_COLOUR, COLOURS, MAP_COLS, MAP_MAX_ROWS, MAP_NAME, MISSING_ITEMS,
  colourDef, colourKey, darkestColour, estimateChange, machineKey, mapRows, placeTile, rankFor, removeTile,
  splitMinutes,
  type Chip, type ChipTone, type MachineState, type MapTile, type MissingKey, type PlanMachine, type PlanOrder,
  type Suggestion,
} from "@/lib/changeover";
import type { ChangeoverResponse, MountResult } from "@/lib/changeover-data";
import { timedJson } from "@/components/dashboard/last-seen";
import { useRemembered } from "@/components/dashboard/use-remembered";
import { Btn, EmptyState, LoadError, Modal, Pill, Spinner, StatTile, iconBtnCls, inputCls } from "@/components/dashboard/ui";
import { AlertTriangle, Check, HelpCircle, LayoutGrid, List, Moon, Pencil, RefreshCw } from "lucide-react";

const LAST_KEY = "itqan.changeover.last.v2";
const STALE_AFTER_MS = 60_000;
const CHIP_TONE: Record<ChipTone, Tone> = { good: "green", warn: "amber", bad: "red", info: "blue" };
const STATE_TONE: Record<MachineState, Tone> = { running: "green", idle: "amber", unknown: "gray" };
const STATE_DOT: Record<MachineState, string> = { running: "bg-emerald-500", idle: "bg-amber-500", unknown: "bg-gray-300" };
const STATE_TILE: Record<MachineState, string> = {
  running: "border-emerald-400 bg-white",
  idle: "border-amber-400 bg-amber-50",
  unknown: "border-gray-300 bg-gray-50",
};
const STATE_WORD: Record<MachineState, string> = { running: "text-emerald-700", idle: "text-amber-700", unknown: "text-gray-500" };
const CHECKS = ["material", "packaging", "connections", "mould", "sample", "workers"] as const;

type Strings = (typeof co)["en"];
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

const LAMP: Record<MachineState, string> = { running: "#10b981", idle: "#f59e0b", unknown: "#cbd5e1" };

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
function MachineGlyph({ colours, now, tonnage, state }: { colours: readonly string[]; now: string; tonnage: string; state: MachineState }) {
  const fillOf = (c: string) => colourDef(c)?.swatch ?? "url(#co-hatch)";
  const stripes = colours.length > 0 ? colours.slice(0, 4) : [""];
  const sw = 16 / stripes.length;
  const barrel = now || (colours.length === 1 ? colours[0] : "");
  // Compact on purpose: a narrower drawing scales up larger inside a phone's
  // 88px tile, and the tonnage on the clamp stays readable there.
  return (
    <svg viewBox="0 0 100 38" preserveAspectRatio="xMidYMid meet" className="block w-full flex-1 min-h-0 my-0.5" aria-hidden="true">
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
  const { data, loading, failed, reload } = useRemembered<ChangeoverResponse>({
    key: LAST_KEY,
    read: () => timedJson<ChangeoverResponse>(authedFetch, freshNext.current ? "/api/changeover?fresh=1" : "/api/changeover"),
    valid: (snap) => Array.isArray(snap?.machines) && Array.isArray(snap?.orders) && Array.isArray(snap?.layout),
    // A snapshot's age is the device's past, not now.
    hydrate: (snap) => ({ ...snap, dataAgeMs: 0 }),
    // An answer without the production log is a degraded one: it is shown
    // when there is nothing better, never remembered, and never allowed to
    // replace a good answer that is already on screen.
    worthRemembering: (next) => next.ok && next.logRead !== false,
    merge: (prev, next) => (next.logRead === false && prev && prev.logRead !== false ? { ...prev, dataAgeMs: next.dataAgeMs } : next),
    onLoaded: (next) => {
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
  const [arranging, setArranging] = useState(false);
  const [machineForm, setMachineForm] = useState<PlanMachine | null>(null);
  const [orderForm, setOrderForm] = useState<PlanOrder | null>(null);
  const [confirm, setConfirm] = useState<{ machine: PlanMachine; pick: Suggestion } | null>(null);
  const [done, setDone] = useState<MountResult | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  const machines = useMemo(() => data?.machines ?? [], [data]);
  const orders = useMemo(() => data?.orders ?? [], [data]);
  const layout = useMemo(() => data?.layout ?? [], [data]);

  // Open on a machine that needs a decision — one standing idle — else the first.
  useEffect(() => {
    if (selected && machines.some((m) => m.label === selected)) return;
    const first = machines.find((m) => m.state === "idle") ?? machines[0];
    if (first) setSelected(first.label);
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
    return fill((strings.chips as Record<string, string>)[key] ?? c.key, vars);
  }, [s, isAr]);
  const missingText = useCallback((keys: string) =>
    keys.split(",").map((k) => { const it = MISSING_ITEMS.find((x) => x.key === k); return it ? (isAr ? it.ar : it.en) : k; }).join("، "), [isAr]);

  const pick = useCallback((label: string) => {
    setSelected(label);
    // The panel is under the map on a phone; bring it into view.
    requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }, []);

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
        <EmptyState text={s.notConnected} />
      </div>
    );
  }

  const count = (st: MachineState) => machines.filter((m) => m.state === st).length;
  const waiting = orders.filter((o) => !(o.mountedOn && o.mountedRunning) && o.remaining !== 0).length;
  const placed = new Set(layout.map((t) => machineKey(t.label)));
  const unplaced = machines.filter((m) => !placed.has(machineKey(m.label)));
  const showMap = view === "map" && layout.length > 0;

  /** A machine as one square of the floor. */
  const tile = (m: PlanMachine, t?: MapTile) => {
    const isSel = m.label === selected;
    return (
      <button
        key={m.label} type="button" aria-pressed={isSel} onClick={() => pick(m.label)}
        aria-label={`${m.label} · ${s.states[m.state]} · ${m.now.products.join(" / ") || s.machines.empty}`}
        style={t ? { gridColumn: `${t.c} / span ${t.w}`, gridRow: `${t.r} / span ${t.h}` } : undefined}
        className={`flex flex-col text-start border-2 rounded-xl px-1.5 pt-1.5 pb-1 overflow-hidden shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${STATE_TILE[m.state]} ${
          isSel ? "ring-2 ring-blue-500 ring-offset-1 !border-blue-500" : ""
        }`}
      >
        <span className="flex items-center justify-between gap-1">
          <span className="font-bold text-[13px] leading-none text-gray-900 whitespace-nowrap">{codeOf(m.label)}</span>
          <span className={`text-[10px] leading-none font-medium whitespace-nowrap ${STATE_WORD[m.state]}`}>{s.states[m.state]}</span>
        </span>
        <MachineGlyph colours={m.now.colours} now={m.now.colourNow} tonnage={tonOf(m.label) || m.tonnage} state={m.state} />
        <span className="text-[11px] leading-[1.15] text-gray-800 line-clamp-2 break-words min-h-[1.6rem]" dir="auto">
          {m.now.products.join(" / ") || <span className="text-gray-400">{s.machines.empty}</span>}
        </span>
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
      </button>
    );
  };

  /** One waiting order, as ranked for the chosen machine. */
  const card = (sg: Suggestion, i: number) => {
    if (!machine) return null;
    const o = sg.order;
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
        <div className="flex flex-wrap gap-2 mt-3">
          <Btn onClick={() => setConfirm({ machine, pick: sg })} className="flex-1 sm:flex-none">{s.rank.mount}</Btn>
          <Btn variant="outline" onClick={() => setOrderForm(o)}>
            <HelpCircle size={15} className={sg.needsAnswers ? "text-amber-600" : ""} />
            {sg.needsAnswers ? s.rank.questionsNeeded : s.rank.questions}
          </Btn>
        </div>
      </li>
    );
  };
  // Master names other machines for these and nobody has said otherwise:
  // listed, but folded away under the ones that belong here.
  const main = plan.ranked.filter((x) => x.fit !== "elsewhere");
  const elsewhere = plan.ranked.filter((x) => x.fit === "elsewhere");

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
      {data.dataAgeMs > STALE_AFTER_MS && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
          {fill(s.dataAge, { age: ageLabel(data.dataAgeMs, isAr) })}
        </p>
      )}
      {data.night && (
        <p className="text-sm text-indigo-800 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 mb-3 flex items-start gap-2">
          <Moon size={16} className="mt-0.5 shrink-0" />{s.night}
        </p>
      )}
      {data.logRead === false && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3 flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />{s.logDown}
        </p>
      )}

      <div className="grid grid-cols-3 gap-2 mb-3">
        <StatTile label={s.summary.running} value={fmtInt(count("running"), isAr)} tone="green" />
        <StatTile label={s.summary.idle} value={fmtInt(count("idle"), isAr)} tone="amber" />
        <StatTile label={s.summary.waiting} value={fmtInt(waiting, isAr)} />
      </div>

      {/* ------------------------------- the floor ------------------------------- */}
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
          {data.writable && (
            <Btn variant="outline" onClick={() => setArranging(true)}><Pencil size={14} />{s.map.edit}</Btn>
          )}
        </div>

        {view === "map" && layout.length === 0 && (
          <p className="text-sm text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mb-2">{s.map.empty}</p>
        )}

        {showMap ? (
          <>
            <div
              dir="ltr" className="grid gap-1.5 border border-slate-300 rounded-2xl p-2"
              style={{
                gridTemplateColumns: `repeat(${MAP_COLS}, minmax(0, 1fr))`, gridAutoRows: "5.75rem",
                // The shop floor: a faint tiled ground under the machines.
                backgroundColor: "#eef2f6",
                backgroundImage: "linear-gradient(#dde3ea 1px, transparent 1px), linear-gradient(90deg, #dde3ea 1px, transparent 1px)",
                backgroundSize: "22px 22px",
              }}
            >
              {layout.map((t) => { const m = machines.find((x) => machineKey(x.label) === machineKey(t.label)); return m ? tile(m, t) : null; })}
            </div>
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

        <p className="text-xs text-gray-500 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {(["running", "idle", "unknown"] as const).map((st) => (
            <span key={st} className="inline-flex items-center gap-1"><span className={`w-2.5 h-2.5 rounded-full ${STATE_DOT[st]}`} />{s.states[st]}</span>
          ))}
          {data.logDate && <span>{fill(s.asOf, { date: formatDate(data.logDate, lang) })}</span>}
        </p>
      </section>

      {/* ---------------------------- the chosen machine ---------------------------- */}
      {machine && (
        <section ref={panelRef} className="scroll-mt-4">
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
              <Btn variant="outline" onClick={() => setMachineForm(machine)} className="shrink-0"><Pencil size={14} />{s.now.edit}</Btn>
            </div>
            {machine.now.products.length > 0 && (() => {
              const o = orderOf(machine);
              return (
                <div className="text-sm text-gray-700 mt-2 space-y-1">
                  <p>
                    <ColourTags colours={machine.now.colours} isAr={isAr} s={s} guessed={machine.now.coloursGuessed} />
                    {machine.now.colours.length > 1 && machine.now.colourNow && (
                      <span className="text-gray-500"> ({fill(s.now.runningColour, { colour: colourName(machine.now.colourNow, isAr, s) })})</span>
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
                  {machine.now.coloursGuessed && (
                    <p className="text-xs text-amber-700 flex items-start gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{s.now.coloursGuessed}</p>
                  )}
                </div>
              );
            })()}
          </div>

          <h2 className="text-base font-bold text-gray-900 mb-2">{fill(s.rank.title, { machine: ltr(machine.label) })}</h2>
          {machine.state === "running" && (main.length > 0 || elsewhere.length > 0) && (
            <p className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mb-2">{s.rank.busyNote}</p>
          )}
          {main.length === 0 && elsewhere.length === 0 && plan.blocked.length === 0 && (
            <EmptyState text={waiting === 0 ? s.rank.noOrders : s.rank.none} />
          )}

          <ol className="space-y-2">{main.map(card)}</ol>

          {elsewhere.length > 0 && (
            <details className="mt-3 group">
              <summary className="cursor-pointer select-none text-sm text-gray-600 min-h-11 inline-flex items-center gap-1.5 hover:text-gray-900">
                {fill(s.rank.elsewhere, { n: elsewhere.length })}
              </summary>
              <ol className="space-y-2 mt-2">{elsewhere.map((sg, i) => card(sg, main.length + i))}</ol>
            </details>
          )}

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
                          : b.reason === "finished"
                            ? s.blocked.finished
                            : fill(s.blocked[b.reason], { machines: ltr(String(b.vars?.machines ?? "")) })}
                      </span>
                    </span>
                    <Btn variant="ghost" onClick={() => setOrderForm(b.order)}><HelpCircle size={15} />{s.rank.questions}</Btn>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {arranging && (
        <ArrangeMap
          machines={machines} initial={layout} isAr={isAr} s={s} cancel={p.common.cancel}
          onClose={() => setArranging(false)} onSaved={async () => { setArranging(false); setView("map"); await reloadFresh(); }}
        />
      )}
      {machineForm && (
        <MachineForm
          machine={machineForm} orders={orders} isAr={isAr} s={s} cancel={p.common.cancel}
          onClose={() => setMachineForm(null)} onSaved={async () => { setMachineForm(null); await reloadFresh(); }}
        />
      )}
      {orderForm && (
        <OrderForm
          order={orderForm} machines={machines} canSetKeyClient={data.canSetKeyClient} isAr={isAr} s={s} cancel={p.common.cancel}
          onClose={() => setOrderForm(null)} onSaved={async () => { setOrderForm(null); await reloadFresh(); }}
        />
      )}
      {confirm && (
        <ConfirmForm
          machine={confirm.machine} pick={confirm.pick} night={data.night} isAr={isAr} s={s} cancel={p.common.cancel}
          minutes={minutes} reasons={confirm.pick.chips.map((c) => chipText(c, co.ar, true)).join(" · ")}
          onClose={() => setConfirm(null)}
          onDone={async (r) => { setConfirm(null); setDone(r); await reloadFresh(); }}
        />
      )}
      {done && done.ok && (
        <Modal open title={s.done.title} onClose={() => setDone(null)} isAr={isAr}>
          <ul className="space-y-2 text-sm text-gray-800">
            <li className="flex items-start gap-2"><Check size={16} className="mt-0.5 text-emerald-600 shrink-0" />{done.replay ? s.done.replay : s.done.log}</li>
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
 * Tap a machine, then tap the square where it stands. The squares are the
 * map's own grid (lib/changeover.ts MAP_COLS wide); a machine can be made
 * wider or taller for the presses that are. Saved as ONE cell of the answers
 * tab, so the floor plan is the owner's data, not the code's.
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

  const rows = Math.min(MAP_MAX_ROWS, Math.max(8, mapRows(tiles) + 2));
  const placedKeys = new Set(tiles.map((t) => machineKey(t.label)));
  const tray = machines.filter((m) => !placedKeys.has(machineKey(m.label)));
  const current = tiles.find((t) => machineKey(t.label) === machineKey(picked));

  const put = (at: { c: number; r: number; w?: number; h?: number }) => {
    if (!picked) return;
    const next = placeTile(tiles, picked, at);
    if (!next) { setNote(s.map.taken); return; }
    setTiles(next); setNote("");
  };
  const resize = (dw: number, dh: number) => {
    if (!current) return;
    put({ c: current.c, r: current.r, w: current.w + dw, h: current.h + dh });
  };

  async function save() {
    if (tiles.length === 0) { onClose(); return; }
    setBusy(true); setError("");
    const r = await post({ action: "answers", items: [{ kind: "map", name: MAP_NAME, values: { layout: tiles } }] });
    if (!r.ok) { setBusy(false); setError(errorText(s, r.reason)); return; }
    await onSaved();
  }

  const small = "min-h-11 px-3 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100 disabled:opacity-40";
  return (
    <Modal open title={s.map.edit} onClose={onClose} isAr={isAr}>
      <p className="text-sm text-gray-600 mb-2">{s.map.hint}</p>

      {tray.length > 0 && (
        <div className="mb-3">
          <p className="text-xs text-gray-500 mb-1">{s.map.unplaced}</p>
          <div className="flex flex-wrap gap-1.5" dir="ltr">
            {tray.map((m) => (
              <button key={m.label} type="button" aria-pressed={picked === m.label} onClick={() => { setPicked(m.label); setNote(""); }}
                className={`min-h-11 px-2.5 rounded-lg border text-sm font-medium ${picked === m.label ? "border-blue-500 bg-blue-50 text-blue-800" : "border-gray-300 text-gray-800 hover:bg-gray-50"}`}>
                {codeOf(m.label)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div
        dir="ltr" className="grid gap-1 bg-gray-100 border border-gray-200 rounded-xl p-1.5"
        style={{ gridTemplateColumns: `repeat(${MAP_COLS}, minmax(0, 1fr))`, gridAutoRows: "2.75rem" }}
      >
        {Array.from({ length: rows * MAP_COLS }, (_, i) => {
          const c = (i % MAP_COLS) + 1, r = Math.floor(i / MAP_COLS) + 1;
          return (
            <button key={`cell-${c}-${r}`} type="button" aria-label={`${s.map.cell} ${c},${r}`} onClick={() => put({ c, r })}
              style={{ gridColumn: c, gridRow: r }}
              className="rounded border border-dashed border-gray-300 bg-white/60 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40" />
          );
        })}
        {tiles.map((t) => {
          const on = machineKey(t.label) === machineKey(picked);
          return (
            <button key={t.label} type="button" aria-pressed={on} onClick={() => { setPicked(t.label); setNote(""); }}
              style={{ gridColumn: `${t.c} / span ${t.w}`, gridRow: `${t.r} / span ${t.h}` }}
              className={`rounded-md border text-[13px] font-bold px-1 overflow-hidden ${on ? "border-blue-600 bg-blue-600 text-white" : "border-gray-400 bg-white text-gray-900"}`}>
              {codeOf(t.label)}
            </button>
          );
        })}
      </div>

      <div className="mt-3 min-h-[5.5rem]">
        {picked ? (
          <>
            <p className="text-sm font-medium text-gray-900 mb-2">{fill(s.map.picked, { machine: ltr(picked) })}</p>
            {current && (
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className={small} onClick={() => resize(1, 0)}>{s.map.wider}</button>
                <button type="button" className={small} disabled={current.w <= 1} onClick={() => resize(-1, 0)}>{s.map.narrower}</button>
                <button type="button" className={small} onClick={() => resize(0, 1)}>{s.map.taller}</button>
                <button type="button" className={small} disabled={current.h <= 1} onClick={() => resize(0, -1)}>{s.map.shorter}</button>
                <button type="button" className={`${small} text-red-700 border-red-200`} onClick={() => { setTiles(removeTile(tiles, picked)); setNote(""); }}>{s.map.remove}</button>
              </div>
            )}
          </>
        ) : null}
        {note && <p className="text-sm text-amber-700 mt-2" role="status">{note}</p>}
      </div>

      {error && <p className="text-sm text-red-700 mt-2" role="alert">{error}</p>}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Btn variant="ghost" onClick={onClose} disabled={busy}>{cancel}</Btn>
        <Btn onClick={save} disabled={busy || tiles.length === 0}>{busy ? s.saving : s.map.save}</Btn>
      </div>
    </Modal>
  );
}

/* --------------------------- «الراكب الآن» + the machine --------------------------- */

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
  const [transparentOnly, setTransparentOnly] = useState(machine.transparentOnly);
  const [bigMachine, setBigMachine] = useState(machine.bigMachine);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const picked = choices.find((o) => o.id === orderId) ?? null;
  const products = mode === "order"
    ? (picked ? [picked.product] : [])
    : product.split("|").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
  const order = mode === "order" && picked && !picked.code.startsWith("#") ? picked.code : "";
  const hereCode = here && !here.code.startsWith("#") ? here.code : "";
  const jobChanged = products.length > 0 && (!sameList(products, now.products) || order !== hereCode);
  // Colours are saved when they were changed — or when a guess is being confirmed.
  const coloursChanged = colours.length > 0 && (!sameList(colours, now.colours) || now.coloursGuessed);
  const settings: Record<string, boolean> = {};
  if (transparentOnly !== machine.transparentOnly) settings.transparentOnly = transparentOnly;
  if (bigMachine !== machine.bigMachine) settings.bigMachine = bigMachine;
  const settingsChanged = Object.keys(settings).length > 0;

  async function save() {
    // Where the colours live: on the work order when there is one (the order
    // decides the colour — the owner's rule), else with the mould on the machine.
    const items: { kind: string; name: string; values: Record<string, unknown> }[] = [];
    if (settingsChanged) items.push({ kind: "machine", name: machine.label, values: settings });
    if (order && coloursChanged) items.push({ kind: "order", name: order, values: { colour: colours } });
    const needRow = products.length > 0 && (jobChanged || (!order && coloursChanged));
    if (products.length === 0 && !settingsChanged) { setError(s.errors.no_product); return; }
    if (items.length === 0 && !needRow) { onClose(); return; }

    setBusy(true); setError("");
    if (items.length > 0) {
      const r = await post({ action: "answers", items });
      if (!r.ok) { setBusy(false); setError(errorText(s, r.reason)); return; }
    }
    if (needRow) {
      const r = await post({
        action: "mount", baseline: true, machine: machine.label, order, products, colours,
        fromProducts: [], fromColours: [], reasons: "تسجيل الراكب الحالي",
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
        <button type="button" className={`flex-1 ${chipCls(mode === "order")}`} aria-pressed={mode === "order"} onClick={() => setMode("order")}>{s.machineForm.order}</button>
        <button type="button" className={`flex-1 ${chipCls(mode === "product")}`} aria-pressed={mode === "product"} onClick={() => setMode("product")}>{s.machineForm.noOrder}</button>
      </div>
      {mode === "order" ? (
        <select
          className={inputCls} value={orderId} aria-label={s.machineForm.order}
          onChange={(e) => {
            setOrderId(e.target.value);
            const o = choices.find((x) => x.id === e.target.value);
            if (o && o.colours.length > 0) setColours(o.colours.filter((c) => c !== ANY_COLOUR));
          }}
        >
          <option value="">—</option>
          {choices.map((o) => <option key={o.id} value={o.id}>{o.code} — {o.product}</option>)}
        </select>
      ) : (
        <>
          <input className={inputCls} value={product} aria-label={s.machineForm.product} placeholder={s.machineForm.product}
            maxLength={300} onChange={(e) => setProduct(e.target.value)} />
          <p className="text-xs text-gray-400 mt-1">{s.machineForm.productHint}</p>
        </>
      )}

      <p className="text-sm font-medium text-gray-900 mt-4">{s.machineForm.colour}</p>
      <p className="text-xs text-gray-500 mb-2">{s.colours.many}</p>
      <ColourPicker value={colours} onChange={setColours} isAr={isAr} s={s} />

      <p className="text-sm font-medium text-gray-900 mt-5 mb-1">{s.machineForm.settings}</p>
      {toggle(s.machineForm.transparentOnly, transparentOnly, setTransparentOnly)}
      {toggle(s.machineForm.bigMachine, bigMachine, setBigMachine)}

      {error && <p className="text-sm text-red-700 mt-3" role="alert">{error}</p>}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Btn variant="ghost" onClick={onClose} disabled={busy}>{cancel}</Btn>
        <Btn onClick={save} disabled={busy}>{busy ? s.saving : s.machineForm.save}</Btn>
      </div>
    </Modal>
  );
}

/* ------------------------------- the questions ------------------------------- */

function OrderForm({ order, machines, canSetKeyClient, isAr, s, cancel, onClose, onSaved }: {
  order: PlanOrder; machines: PlanMachine[]; canSetKeyClient: boolean; isAr: boolean; s: Strings; cancel: string;
  onClose: () => void; onSaved: () => Promise<void>;
}) {
  const [colours, setColours] = useState<string[]>(order.colours);
  const [fits, setFits] = useState<string[]>(order.fits ?? []);
  const [workers, setWorkers] = useState<number | null>(order.workers);
  const [oilCores, setOilCores] = useState<boolean | null>(order.oilCores);
  const [missing, setMissing] = useState<MissingKey[] | null>(order.missing);
  const [keyClient, setKeyClient] = useState(order.keyClient);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    const orderValues: Record<string, unknown> = {};
    // A guess that is left selected and saved becomes the answer.
    if (colours.length > 0 && (order.colourSource !== "answer" || !sameList(colours, order.colours))) orderValues.colour = colours;
    if (missing !== null && (order.missing === null || !sameList(missing, order.missing))) orderValues.missing = missing;
    const moldValues: Record<string, unknown> = {};
    if (fits.length > 0 && !sameList(fits, order.fits ?? [])) moldValues.fits = fits;
    if (workers !== null && workers !== order.workers) moldValues.workers = workers;
    if (oilCores !== null && oilCores !== order.oilCores) moldValues.oilCores = oilCores;

    const items: { kind: string; name: string; values: Record<string, unknown> }[] = [];
    if (Object.keys(orderValues).length > 0 && !order.code.startsWith("#")) items.push({ kind: "order", name: order.code, values: orderValues });
    if (Object.keys(moldValues).length > 0) items.push({ kind: "mold", name: order.product, values: moldValues });
    if (canSetKeyClient && order.client && keyClient !== order.keyClient) items.push({ kind: "client", name: order.client, values: { keyClient } });
    if (items.length === 0) { onClose(); return; }

    setBusy(true); setError("");
    const r = await post({ action: "answers", items });
    if (!r.ok) { setBusy(false); setError(errorText(s, r.reason)); return; }
    await onSaved();
  }

  const q = "text-sm font-medium text-gray-900 mt-5 mb-2 first:mt-0";
  return (
    <Modal open title={fill(s.orderForm.title, { product: order.product })} onClose={onClose} isAr={isAr}>
      <p className={q}>{s.orderForm.colour}</p>
      <p className="text-xs text-gray-500 -mt-1 mb-2">{s.colours.many}</p>
      <ColourPicker value={colours} onChange={setColours} isAr={isAr} s={s} allowAny />

      <p className={q}>{s.orderForm.fits}</p>
      {order.fitsHintText && <p className="text-xs text-gray-500 -mt-1 mb-2">{fill(s.orderForm.fitsHint, { t: order.fitsHintText })}</p>}
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
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={oilCores === true} className={chipCls(oilCores === true)} onClick={() => setOilCores(true)}>{s.orderForm.yes}</button>
        <button type="button" aria-pressed={oilCores === false} className={chipCls(oilCores === false)} onClick={() => setOilCores(false)}>{s.orderForm.no}</button>
      </div>

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

function ConfirmForm({ machine, pick, night, isAr, s, cancel, minutes, reasons, onClose, onDone }: {
  machine: PlanMachine; pick: Suggestion; night: boolean; isAr: boolean; s: Strings; cancel: string;
  minutes: (min: number) => string; reasons: string;
  onClose: () => void; onDone: (r: MountResult) => Promise<void>;
}) {
  const o = pick.order;
  const [colours, setColours] = useState<string[]>(o.colours);
  const [start, setStart] = useState(pick.startColour);
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const startColour = colours.includes(start) ? start : colours[0] ?? "";
  const standing = machine.now.products.find((x) => x === o.product) ?? machine.now.products[0] ?? "";
  // The estimate follows the colour that will actually start.
  const est = useMemo(() => estimateChange(
    { product: standing, colour: machine.now.colourNow || darkestColour(machine.now.colours), material: machine.now.material },
    { product: o.product, colour: startColour, material: o.material },
    { bigMachine: machine.bigMachine, oilCores: o.oilCores },
  ), [machine, o, standing, startColour]);
  const allTicked = CHECKS.every((k) => ticks[k]);
  const ready = allTicked && !!startColour;

  async function go() {
    if (!ready) return;
    setBusy(true); setError("");
    const real = !o.code.startsWith("#");
    // Colours picked here for an order that had none are the order's answer too.
    if (real && (o.colourSource !== "answer" || !sameList(colours, o.colours))) {
      const a = await post({ action: "answers", items: [{ kind: "order", name: o.code, values: { colour: colours } }] });
      if (!a.ok) { setBusy(false); setError(errorText(s, a.reason)); return; }
    }
    const r = await post({
      action: "mount", machine: machine.label, order: real ? o.code : "",
      products: [o.product], colours: [startColour],
      fromProducts: machine.now.products, fromColours: machine.now.colours,
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
              ? <>{machine.now.products.join(" / ")} · <ColourTags colours={machine.now.colours} isAr={isAr} s={s} /></>
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

      {o.colours.length === 0 && (
        <div className="mt-3">
          <p className="text-sm text-amber-700 mb-2">{s.confirm.colourNeeded}</p>
          <ColourPicker value={colours} onChange={setColours} isAr={isAr} s={s} allowAny />
        </div>
      )}
      {colours.length > 1 && (
        <div className="mt-3">
          <p className="text-sm font-medium text-gray-900 mb-2">{s.confirm.startColour}</p>
          <div className="flex flex-wrap gap-2">
            {colours.map((c) => (
              <button key={c} type="button" aria-pressed={startColour === c} className={chipCls(startColour === c)} onClick={() => setStart(c)}>
                <Swatch colour={c} />{colourName(c, isAr, s)}
              </button>
            ))}
          </div>
        </div>
      )}
      {colours.length === 1 && (
        <p className="text-sm text-gray-700 mt-2"><ColourTags colours={colours} isAr={isAr} s={s} /></p>
      )}

      <div className="mt-3 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 tabular-nums">
        <p>{s.rank.mould}: {est.sameMould ? s.rank.sameMould : `${s.approx} ${minutes(est.swapMin)}`}</p>
        <p>{s.rank.purge}: {s.approx} {minutes(est.purgeMin)}</p>
        {est.drying && (
          <p className="text-amber-700">
            {fill(s.chips.drying, { h: est.drying.minH === est.drying.maxH ? `${est.drying.minH}` : `${est.drying.minH}–${est.drying.maxH}` })}
          </p>
        )}
      </div>

      {night && (
        <p className="mt-3 text-sm text-indigo-800 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 flex items-start gap-2">
          <Moon size={16} className="mt-0.5 shrink-0" />{s.confirm.nightWarn}
        </p>
      )}

      <p className="text-sm font-medium text-gray-900 mt-4 mb-1">{s.confirm.checklist}</p>
      {CHECKS.map((k) => (
        <label key={k} className="flex items-start gap-3 min-h-11 py-1.5 text-sm text-gray-800 cursor-pointer">
          <input type="checkbox" className="w-5 h-5 mt-0.5 shrink-0" checked={!!ticks[k]} onChange={(e) => setTicks({ ...ticks, [k]: e.target.checked })} />
          {s.confirm.checks[k]}
        </label>
      ))}

      <p className="text-xs text-gray-500 mt-3">{s.confirm.writes}</p>
      {!ready && <p className="text-xs text-amber-700 mt-1">{!startColour ? s.confirm.colourNeeded : s.confirm.tickAll}</p>}
      {error && <p className="text-sm text-red-700 mt-2" role="alert">{error}</p>}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Btn variant="ghost" onClick={onClose} disabled={busy}>{cancel}</Btn>
        <Btn onClick={go} disabled={busy || !ready}>{busy ? s.saving : s.confirm.go}</Btn>
      </div>
    </Modal>
  );
}
