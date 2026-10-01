"use client";
import { usePageTitle } from "@/components/dashboard/use-page-title";
/**
 * «خطة الاسطمبات» — which mould goes on which machine next (2026-09-30,
 * the owner's and the production engineer's brief).
 *
 * The engineer taps the machine that finished and gets the waiting work
 * orders ranked for THAT machine, each with the reasons beside it (same
 * colour, key client, late, dry the material now) and an estimate of what the
 * change costs. What the sheet does not know — the order's colour, which
 * machines a mould fits, what is still missing — the page ASKS, once, and
 * remembers in «إجابات خطة الاسطمبات».
 *
 * It suggests; he decides. «ركّب دي» opens a checklist and only its confirm
 * writes: one row in «تغييرات الاسطمبات», the machine on the work order, the
 * product on the machines tab — each outcome said on its own.
 *
 * The rules (order of priority, colour ladder, minutes, what blocks an order)
 * are in lib/changeover.ts and unit-tested; this file asks, ranks with those
 * functions in the browser, and draws.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "@/context/LangContext";
import { authedFetch } from "@/lib/authed-fetch";
import { co } from "@/lib/i18n.changeover";
import { pd } from "@/lib/i18n.prod";
import { formatDate } from "@/lib/dates";
import { ageLabel, fill, fmtInt } from "@/lib/format";
import { localize, JOB_STATUSES, type Tone } from "@/lib/prod-meta";
import {
  ANY_COLOUR, COLOURS, MISSING_ITEMS, colourDef, colourKey, estimateChange, machineKey, rankFor, splitMinutes,
  type Chip, type ChipTone, type MissingKey, type PlanMachine, type PlanOrder, type Suggestion,
} from "@/lib/changeover";
import type { ChangeoverResponse, MountResult } from "@/lib/changeover-data";
import { timedJson } from "@/components/dashboard/last-seen";
import { useRemembered } from "@/components/dashboard/use-remembered";
import { Btn, EmptyState, LoadError, Modal, Pill, Spinner, iconBtnCls, inputCls } from "@/components/dashboard/ui";
import { AlertTriangle, Check, HelpCircle, Moon, RefreshCw } from "lucide-react";

const LAST_KEY = "itqan.changeover.last";
const STALE_AFTER_MS = 60_000;
const CHIP_TONE: Record<ChipTone, Tone> = { good: "green", warn: "amber", bad: "red", info: "gray" };
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

/* --------------------------------- colours -------------------------------- */

function colourName(key: string, isAr: boolean, s: Strings): string {
  if (!key) return "";
  if (key === ANY_COLOUR) return s.colours.any;
  const d = colourDef(key);
  return d ? (isAr ? d.ar : d.en) : key;
}

function Swatch({ colour }: { colour: string }) {
  const d = colourDef(colour);
  return (
    <span
      aria-hidden="true"
      className="inline-block w-3.5 h-3.5 rounded-full border border-gray-300 shrink-0 align-[-2px]"
      style={{ background: d ? d.swatch : "repeating-linear-gradient(45deg,#e5e7eb,#e5e7eb 3px,#fff 3px,#fff 6px)" }}
    />
  );
}

/** Tap a colour; «لون آخر» opens a text box for one the list does not have. */
function ColourPicker({ value, onChange, isAr, s, allowAny }: {
  value: string; onChange: (key: string) => void; isAr: boolean; s: Strings; allowAny?: boolean;
}) {
  const custom = !!value && value !== ANY_COLOUR && !colourDef(value);
  const [other, setOther] = useState(custom);
  // What was typed, as typed — `value` is the folded key, which would eat a
  // trailing space on every keystroke.
  const [text, setText] = useState(custom ? value : "");
  const chip = (active: boolean) =>
    `inline-flex items-center gap-1.5 min-h-11 px-3 rounded-lg border text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
      active ? "border-blue-500 bg-blue-50 text-blue-800 font-medium" : "border-gray-300 text-gray-700 hover:bg-gray-50 active:bg-gray-100"
    }`;
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {COLOURS.map((c) => (
          <button key={c.key} type="button" aria-pressed={value === c.key} className={chip(value === c.key && !other)}
            onClick={() => { setOther(false); onChange(c.key); }}>
            <Swatch colour={c.key} />{isAr ? c.ar : c.en}
          </button>
        ))}
        {allowAny && (
          <button type="button" aria-pressed={value === ANY_COLOUR} className={chip(value === ANY_COLOUR && !other)}
            onClick={() => { setOther(false); onChange(ANY_COLOUR); }}>
            {s.colours.any}
          </button>
        )}
        <button type="button" aria-pressed={other} className={chip(other)} onClick={() => { setOther(true); if (!custom) { setText(""); onChange(""); } }}>
          {s.colours.other}
        </button>
      </div>
      {other && (
        <input
          className={`${inputCls} mt-2`} value={text} placeholder={s.colours.otherPlaceholder}
          aria-label={s.colours.other} maxLength={40}
          onChange={(e) => { setText(e.target.value); onChange(colourKey(e.target.value)); }}
        />
      )}
    </div>
  );
}

function ColourTag({ colour, isAr, s }: { colour: string; isAr: boolean; s: Strings }) {
  if (!colour) return <span className="text-amber-700">{s.now.noColour}</span>;
  return <span className="inline-flex items-center gap-1 whitespace-nowrap"><Swatch colour={colour} />{colourName(colour, isAr, s)}</span>;
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
    valid: (snap) => Array.isArray(snap?.machines) && Array.isArray(snap?.orders),
    // A snapshot's age and clock are the device's past, not now.
    hydrate: (snap) => ({ ...snap, dataAgeMs: 0 }),
    worthRemembering: (next) => next.ok,
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
  const [showInactive, setShowInactive] = useState(false);
  const [machineForm, setMachineForm] = useState<PlanMachine | null>(null);
  const [orderForm, setOrderForm] = useState<PlanOrder | null>(null);
  const [confirm, setConfirm] = useState<{ machine: PlanMachine; pick: Suggestion } | null>(null);
  const [done, setDone] = useState<MountResult | null>(null);

  const machines = useMemo(() => data?.machines ?? [], [data]);
  const orders = useMemo(() => data?.orders ?? [], [data]);
  const active = useMemo(() => machines.filter((m) => m.active), [machines]);
  const inactive = useMemo(() => machines.filter((m) => !m.active), [machines]);

  // Open on the machine that needs a decision; else the first active one.
  useEffect(() => {
    if (selected && machines.some((m) => m.label === selected)) return;
    const first = active.find((m) => m.state === "free") ?? active[0] ?? machines[0];
    if (first) setSelected(first.label);
  }, [machines, active, selected]);

  const machine = machines.find((m) => m.label === selected) ?? null;
  const transparentMachines = useMemo(() => machines.filter((m) => m.transparentOnly).map((m) => m.label), [machines]);
  const plan = useMemo(
    () => (machine ? rankFor(machine, orders, { today: data?.today ?? "", transparentMachines }) : { ranked: [], blocked: [] }),
    [machine, orders, data?.today, transparentMachines],
  );
  const orderOn = useCallback(
    (m: PlanMachine) => orders.find((o) => o.mountedOn && machineKey(o.mountedOn) === machineKey(m.label)) ?? null,
    [orders],
  );

  const minutes = useCallback((min: number) => {
    const { h, m } = splitMinutes(min);
    if (h > 0 && m > 0) return fill(s.rank.hoursMinutes, { h, m });
    return h > 0 ? fill(s.rank.hours, { h }) : fill(s.rank.minutes, { m });
  }, [s]);
  const chipText = useCallback((c: Chip, strings: Strings = s) => {
    // Arabic counts its days: يوم، يومين، 3–10 أيام، 11+ يوم.
    const n = Number(c.vars?.n);
    const key =
      c.key === "late" ? (n === 1 ? "lateOne" : n === 2 ? "lateTwo" : n <= 10 ? "lateFew" : "late")
      : c.key === "workers" && n === 2 ? "workersTwo"
      : c.key;
    return fill((strings.chips as Record<string, string>)[key] ?? c.key, c.vars ?? {});
  }, [s]);
  const missingText = useCallback((keys: string) =>
    keys.split(",").map((k) => { const it = MISSING_ITEMS.find((x) => x.key === k); return it ? (isAr ? it.ar : it.en) : k; }).join("، "), [isAr]);

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

  const nobodyConfirmed = machines.every((m) => m.now.source !== "plan");

  const machineCard = (m: PlanMachine) => {
    const on = orderOn(m);
    const isSel = m.label === selected;
    const tone: Tone = m.state === "free" ? "blue" : m.state === "running" ? "green" : "gray";
    return (
      <button
        key={m.label} type="button" aria-pressed={isSel} onClick={() => setSelected(m.label)}
        className={`text-start bg-white border rounded-xl p-3 min-h-11 transition-colors hover:bg-gray-50 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
          isSel ? "border-blue-500 ring-2 ring-blue-500/20" : "border-gray-200"
        } ${m.active ? "" : "opacity-70"}`}
      >
        <span className="block font-semibold text-gray-900 whitespace-nowrap" dir="ltr">{m.label}</span>
        <span className="block text-sm text-gray-700 mt-1 break-words">{m.now.product || <span className="text-gray-400">{s.machines.empty}</span>}</span>
        {m.now.product && (
          <span className="block text-xs text-gray-500 mt-0.5"><ColourTag colour={m.now.colour} isAr={isAr} s={s} /></span>
        )}
        <span className="flex flex-wrap gap-1 mt-2">
          <Pill text={s.machines.state[m.state]} tone={tone} />
          {m.transparentOnly && <Pill text={s.machines.transparentOnly} tone="blue" />}
          {m.bigMachine && <Pill text={s.machines.bigMachine} tone="gray" />}
        </span>
        {on && on.remaining !== null && (
          <span className="block text-xs text-gray-500 mt-1.5 tabular-nums">
            {fill(s.machines.left, { n: `${fmtInt(on.remaining, isAr)} ${s.rank.pieces}` })}
          </span>
        )}
      </button>
    );
  };

  return (
    <div dir={isAr ? "rtl" : "ltr"}>
      <div className="mb-5">
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
      {nobodyConfirmed && (
        <p className="text-sm text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mb-3 flex items-start gap-2">
          <HelpCircle size={16} className="mt-0.5 shrink-0" />{s.firstUse}
        </p>
      )}

      {/* ------------------------------- machines ------------------------------- */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold text-gray-900">{s.machines.title}</h2>
        <p className="text-xs text-gray-500 mb-2">{s.machines.hint}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">{active.map(machineCard)}</div>
        {inactive.length > 0 && (
          <div className="mt-2">
            <button type="button" className="text-xs text-gray-500 underline min-h-11 sm:min-h-0" aria-expanded={showInactive}
              onClick={() => setShowInactive((v) => !v)}>
              {fill(s.machines.inactive, { n: inactive.length })}
            </button>
            {showInactive && <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mt-2">{inactive.map(machineCard)}</div>}
          </div>
        )}
      </section>

      {/* ---------------------------- the chosen machine ---------------------------- */}
      {machine && (
        <section>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h2 className="text-lg font-bold text-gray-900">{fill(s.rank.title, { machine: ltr(machine.label) })}</h2>
            <Btn variant="outline" onClick={() => setMachineForm(machine)}>{s.now.edit}</Btn>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl px-3 py-2.5 mb-3 text-sm">
            <span className="text-gray-500">{s.now.title}: </span>
            {machine.now.product ? (
              <span className="text-gray-900">
                <span className="font-medium">{machine.now.product}</span>
                {" · "}<ColourTag colour={machine.now.colour} isAr={isAr} s={s} />
                {" · "}{machine.now.material || <span className="text-amber-700">{s.now.noMaterial}</span>}
                {machine.now.source === "registry" && <span className="text-xs text-gray-400"> ({s.machines.fromRegistry})</span>}
              </span>
            ) : <span className="text-gray-400">{s.machines.empty}</span>}
            {machine.now.source !== "plan" && (
              <p className="text-xs text-amber-700 mt-1.5 flex items-start gap-1.5">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />{s.now.notRecorded}
              </p>
            )}
          </div>

          {plan.ranked.length === 0 && plan.blocked.length === 0 && (
            <EmptyState text={orders.length === 0 ? s.rank.noOrders : s.rank.none} />
          )}

          <ol className="space-y-2">
            {plan.ranked.map((sg, i) => {
              const o = sg.order;
              return (
                <li key={o.id} className="bg-white border border-gray-200 rounded-xl p-3 sm:p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p className="font-semibold text-gray-900 min-w-0 break-words">
                      <span className="text-gray-400 tabular-nums">{i + 1} · </span>{o.product}
                      {" · "}<ColourTag colour={o.colour} isAr={isAr} s={s} />
                    </p>
                    <p className="text-sm text-gray-600 whitespace-nowrap tabular-nums">
                      {s.rank.change} {s.approx} {minutes(sg.estimate.totalMin)}
                    </p>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    <span dir="ltr">{o.code}</span>
                    {o.client && <> · {o.client}</>}
                    {" · "}{o.dueDate ? `${s.rank.due} ${formatDate(o.dueDate, lang)}` : s.rank.noDue}
                    {" · "}{s.rank.remaining}{" "}
                    <span className="tabular-nums">
                      {o.remaining !== null ? `${fmtInt(o.remaining, isAr)} ${s.rank.pieces}` : `${fmtInt(o.qtyKg, isAr)} ${s.rank.kg}`}
                    </span>
                    {" · "}{localize(o.status, JOB_STATUSES, p.jobs.statuses)}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {sg.chips.map((c) => <Pill key={c.key} text={chipText(c)} tone={CHIP_TONE[c.tone]} />)}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <Btn onClick={() => setConfirm({ machine, pick: sg })} className="flex-1 sm:flex-none">{s.rank.mount}</Btn>
                    <Btn variant="outline" onClick={() => setOrderForm(o)}><HelpCircle size={15} />{s.rank.questions}</Btn>
                  </div>
                </li>
              );
            })}
          </ol>

          {plan.blocked.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-1">{s.blocked.title}</h3>
              <ul className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
                {plan.blocked.map((b) => (
                  <li key={b.order.id} className="px-3 py-2.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block text-sm text-gray-900 break-words">
                        {b.order.product} · <ColourTag colour={b.order.colour} isAr={isAr} s={s} />
                      </span>
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
          minutes={minutes} reasons={confirm.pick.chips.map((c) => chipText(c, co.ar)).join(" · ")}
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
              const note = (s.done.notes as Record<string, string>)[k === "job" ? done.jobNote : done.registryNote] ?? (k === "job" ? done.jobNote : done.registryNote);
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

/* --------------------------- «الراكب الآن» + the machine --------------------------- */

function MachineForm({ machine, orders, isAr, s, cancel, onClose, onSaved }: {
  machine: PlanMachine; orders: PlanOrder[]; isAr: boolean; s: Strings; cancel: string;
  onClose: () => void; onSaved: () => Promise<void>;
}) {
  const here = orders.find((o) => o.mountedOn && machineKey(o.mountedOn) === machineKey(machine.label));
  // An order standing on another machine cannot also be standing on this one.
  const choices = orders.filter((o) => !o.mountedOn || o === here);
  const [mode, setMode] = useState<"order" | "product">(here || (!machine.now.product && choices.length > 0) ? "order" : "product");
  const [orderId, setOrderId] = useState(here?.id ?? "");
  const [product, setProduct] = useState(here ? "" : machine.now.product);
  const [colour, setColour] = useState(machine.now.colour);
  const [transparentOnly, setTransparentOnly] = useState(machine.transparentOnly);
  const [bigMachine, setBigMachine] = useState(machine.bigMachine);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const picked = choices.find((o) => o.id === orderId) ?? null;
  const nowProduct = mode === "order" ? picked?.product ?? "" : product.trim();
  const nowOrder = mode === "order" && picked && !picked.code.startsWith("#") ? picked.code : "";
  const stateChanged =
    !!nowProduct && (
      machine.now.source !== "plan"
      || nowProduct !== machine.now.product
      || colour !== machine.now.colour
      || nowOrder !== machine.now.order
    );
  const settings: Record<string, boolean> = {};
  if (transparentOnly !== machine.transparentOnly) settings.transparentOnly = transparentOnly;
  if (bigMachine !== machine.bigMachine) settings.bigMachine = bigMachine;
  const settingsChanged = Object.keys(settings).length > 0;

  async function save() {
    if (!stateChanged && !settingsChanged) { onClose(); return; }
    setBusy(true); setError("");
    if (settingsChanged) {
      const r = await post({ action: "answers", items: [{ kind: "machine", name: machine.label, values: settings }] });
      if (!r.ok) { setBusy(false); setError(errorText(s, r.reason)); return; }
    }
    if (stateChanged) {
      const r = await post({ action: "mount", baseline: true, machine: machine.label, order: nowOrder, product: nowProduct, colour, reasons: "تسجيل الراكب الحالي" });
      if (!r.ok) { setBusy(false); setError(errorText(s, r.reason)); return; }
    }
    await onSaved();
  }

  const radio = (on: boolean) =>
    `flex-1 min-h-11 px-3 rounded-lg border text-sm transition-colors ${on ? "border-blue-500 bg-blue-50 text-blue-800 font-medium" : "border-gray-300 text-gray-700 hover:bg-gray-50"}`;
  const toggle = (label: string, value: boolean, set: (v: boolean) => void) => (
    <label className="flex items-center gap-3 min-h-11 text-sm text-gray-800 cursor-pointer">
      <input type="checkbox" className="w-5 h-5 shrink-0" checked={value} onChange={(e) => set(e.target.checked)} />{label}
    </label>
  );

  return (
    <Modal open title={fill(s.machineForm.title, { machine: ltr(machine.label) })} onClose={onClose} isAr={isAr}>
      <p className="text-sm font-medium text-gray-900 mb-2">{s.machineForm.what}</p>
      <div className="flex gap-2 mb-3">
        <button type="button" className={radio(mode === "order")} aria-pressed={mode === "order"} onClick={() => setMode("order")}>{s.machineForm.order}</button>
        <button type="button" className={radio(mode === "product")} aria-pressed={mode === "product"} onClick={() => setMode("product")}>{s.machineForm.noOrder}</button>
      </div>
      {mode === "order" ? (
        <select
          className={inputCls} value={orderId} aria-label={s.machineForm.order}
          onChange={(e) => {
            setOrderId(e.target.value);
            const o = choices.find((x) => x.id === e.target.value);
            if (o?.colour) setColour(o.colour);
          }}
        >
          <option value="">—</option>
          {choices.map((o) => <option key={o.id} value={o.id}>{o.code} — {o.product}</option>)}
        </select>
      ) : (
        <input className={inputCls} value={product} aria-label={s.machineForm.product} placeholder={s.machineForm.product}
          maxLength={160} onChange={(e) => setProduct(e.target.value)} />
      )}

      <p className="text-sm font-medium text-gray-900 mt-4 mb-2">{s.machineForm.colour}</p>
      <ColourPicker value={colour} onChange={setColour} isAr={isAr} s={s} />

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
  const [colour, setColour] = useState(order.colour);
  const [fits, setFits] = useState<string[]>(order.fits ?? []);
  const [workers, setWorkers] = useState<number | null>(order.workers);
  const [oilCores, setOilCores] = useState<boolean | null>(order.oilCores);
  const [missing, setMissing] = useState<MissingKey[] | null>(order.missing);
  const [keyClient, setKeyClient] = useState(order.keyClient);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");
  const chip = (on: boolean, tone: "blue" | "red" | "green" = "blue") => {
    const onCls = tone === "red" ? "border-red-400 bg-red-50 text-red-800" : tone === "green" ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-blue-500 bg-blue-50 text-blue-800";
    return `inline-flex items-center justify-center min-h-11 px-3 rounded-lg border text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
      on ? `${onCls} font-medium` : "border-gray-300 text-gray-700 hover:bg-gray-50 active:bg-gray-100"
    }`;
  };

  async function save() {
    const orderValues: Record<string, unknown> = {};
    if (colour && (order.colourSource !== "answer" || colour !== order.colour)) orderValues.colour = colour;
    if (missing !== null && (order.missing === null || !same(missing, order.missing))) orderValues.missing = missing;
    const moldValues: Record<string, unknown> = {};
    if (fits.length > 0 && !same(fits, order.fits ?? [])) moldValues.fits = fits;
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
      <ColourPicker value={colour} onChange={setColour} isAr={isAr} s={s} allowAny />

      <p className={q}>{s.orderForm.fits}</p>
      {order.fitsHintText && <p className="text-xs text-gray-500 -mt-1 mb-2">{fill(s.orderForm.fitsHint, { t: order.fitsHintText })}</p>}
      <div className="flex flex-wrap gap-2">
        {machines.map((m) => {
          const on = fits.some((l) => machineKey(l) === machineKey(m.label));
          return (
            <button key={m.label} type="button" dir="ltr" aria-pressed={on} className={`${chip(on)} ${m.active ? "" : "opacity-70"}`}
              onClick={() => setFits(on ? fits.filter((l) => machineKey(l) !== machineKey(m.label)) : [...fits, m.label])}>
              {m.label}
            </button>
          );
        })}
      </div>

      <p className={q}>{s.orderForm.workers}</p>
      <div className="flex flex-wrap gap-2">
        {[1, 2, 3].map((n) => (
          <button key={n} type="button" aria-pressed={workers === n} className={`${chip(workers === n)} min-w-11 tabular-nums`} onClick={() => setWorkers(n)}>{n}</button>
        ))}
      </div>

      <p className={q}>{s.orderForm.oilCores}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={oilCores === true} className={chip(oilCores === true)} onClick={() => setOilCores(true)}>{s.orderForm.yes}</button>
        <button type="button" aria-pressed={oilCores === false} className={chip(oilCores === false)} onClick={() => setOilCores(false)}>{s.orderForm.no}</button>
      </div>

      <p className={q}>{s.orderForm.missing}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={missing !== null && missing.length === 0} className={chip(missing !== null && missing.length === 0, "green")}
          onClick={() => setMissing([])}>
          {s.orderForm.nothingMissing}
        </button>
        {MISSING_ITEMS.map((it) => {
          const on = !!missing && missing.includes(it.key);
          return (
            <button key={it.key} type="button" aria-pressed={on} className={chip(on, "red")}
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
  const [colour, setColour] = useState(o.colour);
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // The estimate follows the colour picked HERE, when the order had none.
  const est = useMemo(() => estimateChange(
    { product: machine.now.product, colour: machine.now.colour, material: machine.now.material },
    { product: o.product, colour, material: o.material },
    { bigMachine: machine.bigMachine, oilCores: o.oilCores },
  ), [machine, o, colour]);
  const allTicked = CHECKS.every((k) => ticks[k]);
  const ready = allTicked && !!colour;

  async function go() {
    if (!ready) return;
    setBusy(true); setError("");
    const r = await post({
      action: "mount", machine: machine.label,
      order: o.code.startsWith("#") ? "" : o.code,
      product: o.product, colour, minutes: est.totalMin, reasons,
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
            {machine.now.product
              ? <>{machine.now.product} · <ColourTag colour={machine.now.colour} isAr={isAr} s={s} /></>
              : <span className="text-gray-400">{s.confirm.nothingOn}</span>}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-gray-500 shrink-0 w-16">{s.confirm.to}</dt>
          <dd className="text-gray-900 font-medium min-w-0 break-words">
            {o.product} · <ColourTag colour={colour} isAr={isAr} s={s} /> <span className="text-gray-400 font-normal" dir="ltr">({o.code})</span>
          </dd>
        </div>
      </dl>

      {!o.colour && (
        <div className="mt-3">
          <p className="text-sm text-amber-700 mb-2">{s.confirm.colourNeeded}</p>
          <ColourPicker value={colour} onChange={setColour} isAr={isAr} s={s} allowAny />
        </div>
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
      {!ready && <p className="text-xs text-amber-700 mt-1">{!colour ? s.confirm.colourNeeded : s.confirm.tickAll}</p>}
      {error && <p className="text-sm text-red-700 mt-2" role="alert">{error}</p>}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Btn variant="ghost" onClick={onClose} disabled={busy}>{cancel}</Btn>
        <Btn onClick={go} disabled={busy || !ready}>{busy ? s.saving : s.confirm.go}</Btn>
      </div>
    </Modal>
  );
}
