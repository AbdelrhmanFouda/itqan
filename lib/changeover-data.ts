import {
  getRecords, appendRecord, ensureHeaders, ensureTab, updateRecord, expectSupported, sheetsWritable, lazyTabMissing,
  type SheetRecord, type UpdateResult,
} from "@/lib/sheets";
import { loadJobs, type JobShaped } from "@/lib/jobs";
import { nameKey } from "@/lib/master-lookup";
import { codeKey, isOpenOrder, machineMatch } from "@/lib/work-orders";
import { latinDigits, normalizeDate, todayIso } from "@/lib/dates";
import { cairoStamp } from "@/lib/customer-requests";
import { isDayOffRow } from "@/lib/run-join";
import { getOpenDowntimeEvents } from "@/lib/db";
import { hasFullAccess, type Role } from "@/lib/roles";
import {
  ANSWERS_HEADERS, ANSWERS_TAB, LOG_HEADERS, LOG_TAB, ANSWER_COLUMNS, ANY_COLOUR, BASELINE_REASON, FITS_UNKNOWN,
  MAP_NAME, MISSING_ITEMS, NO_ORDER,
  answersFor, colourFromMaterial, colourKey, coloursFromSheet, coloursToSheet, colourToSheet, daysBefore, fold,
  formatLayout, guessColour, isBaselineRow, isNightHour, kindFromSheet, kindToSheet, latestRuns, listFromSheet,
  listToSheet, logSinceTold, looseNameKey, machineKey, machineState, mergeAnswers, missingFromSheet, missingToSheet,
  newestHolders, parseLayout, parseYesNo, resolveNow, safeText, shiftRank, stampClockMinutes, stampDay,
  standingFromLog, standingWithStart, validLayout, yesNo,
  type AnswerColumn, type AnswerKind, type AnswerRow, type LogRow, type MapTile, type PlanMachine,
  type PlanOrder, type PlanStanding, type Stoppage,
} from "@/lib/changeover";

/**
 * «خطة الاسطمبات» — the server glue between the workbook and the rules.
 *
 * The rules are in lib/changeover.ts, which imports nothing so Node's test
 * runner can load it and the page can rank in the browser. This file is the
 * half that touches the sheet: it works out what stands on every machine,
 * shapes the open orders, joins the engineer's standing answers on, and does
 * the three writes a confirmed change makes. Same split as lib/stock-data.ts
 * over lib/stock.ts.
 *
 * READS  «الإنتاج» (what each machine ran in its latest shift — the truth
 *        about "now"), «الماكينات» (which machines exist), «أوامر العمل»,
 *        «الرئيسي», the page's own two tabs, and the stoppages running now.
 * WRITES «إجابات خطة الاسطمبات» and «تغييرات الاسطمبات» (appends only), and on
 *        a confirmed change the order's «الماكينة» cell and the machine's
 *        «أسم المنتج» cell — the two the owner asked for. Never the order's
 *        status: «ابدأ التشغيل» on the jobs page is still the go-ahead.
 */

export type ChangeoverResponse = {
  ok: boolean;
  configured: boolean;
  writable: boolean;
  /** Cairo today, ISO — what "late" is measured against. */
  today: string;
  /** The newest date in «الإنتاج» — what "running" is measured against. */
  logDate: string;
  /** «الإنتاج» answered with rows. False = the read failed (or the tab is
   *  empty) and every machine is showing the registry's stale cell instead —
   *  the page must SAY so, not look like a quiet factory. */
  logRead: boolean;
  /** «الرئيسي» answered with rows — without it no material is known and
   *  every estimate is priced as "unknown material". */
  masterRead: boolean;
  /** The page's own two tabs were read (or are known not to exist yet).
   *  False = a read FAILED, and every answer, every confirm and the map are
   *  missing from this response — it must not replace a good view. */
  plannerRead: boolean;
  /** 20:00–08:00 Cairo: no mould changes and no samples on the night shift. */
  night: boolean;
  /** Only the owner and a manager mark a client as important. */
  canSetKeyClient: boolean;
  /** How many clients are marked important — 0 means the first tier of the
   *  owner's order does nothing yet, and the page says so. */
  keyClients: number;
  machines: PlanMachine[];
  orders: PlanOrder[];
  /** The floor map, as arranged on the page; [] until somebody arranges it. */
  layout: MapTile[];
  /** The running stoppages were read. False = Firestore did not answer in
   *  time, and no machine can show as stopped — the page says so. */
  stoppagesRead: boolean;
  /** ms since the OLDEST read behind these rows. */
  dataAgeMs: number;
};

const none = () => ({ records: [] as SheetRecord[], readAt: Date.now(), fields: [] as string[] });

function cairoHour(now = Date.now()): number {
  try {
    const h = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", hour12: false })
      .format(new Date(now));
    return Number(h) % 24;
  } catch {
    return new Date(now).getUTCHours();
  }
}

/** «100», «100&180» → the tonnages Master names for a mould. */
const tonnagesIn = (text: string | undefined): string[] =>
  Array.from(new Set(latinDigits(text ?? "").match(/\d{2,4}/g) ?? []));

type Registry = { label: string; tonnage: string; code: string; row: number; product: string }[];

/** «الماكينات», one entry per row — labels built the way /api/machines does. */
function registryFrom(records: readonly SheetRecord[]): Registry {
  const out: Registry = [];
  for (const r of records) {
    const tonnage = latinDigits((r.name || "").trim());
    if (!tonnage) continue;
    const code = (r.code || "").trim();
    out.push({
      label: (r.label || "").trim() || (code ? `${code} — ${tonnage}` : `${tonnage} — بدون كود`),
      tonnage, code, row: r.row,
      product: (r.product || "").trim(),
    });
  }
  return out;
}

function keyFor(kind: AnswerKind, name: string): string {
  switch (kind) {
    case "machine": return machineKey(name);
    case "mold": return nameKey(name);
    case "order": return codeKey(name);
    case "client":
    case "map": return fold(name);
  }
}

/** A name cell as it was meant: a leading apostrophe only forces text (see textCell). */
const unquote = (v: string | undefined): string => (v || "").replace(/^'/, "");

function answerRows(records: readonly SheetRecord[]): AnswerRow[] {
  return records.map((r) => {
    const kind = kindFromSheet(r.kind);
    const row: AnswerRow = { kind, key: kind ? keyFor(kind, unquote(r.name)) : "" };
    for (const col of Object.keys(ANSWER_COLUMNS) as AnswerColumn[]) row[col] = r[col] || "";
    return row;
  });
}

/**
 * The stoppages running RIGHT NOW, per machine — the floor's own real-time
 * word (/dashboard/downtime keeps them in Firestore until somebody taps stop).
 * A stoppage whose resume was already reported («−30 دقيقة») is a machine
 * that is back, so it is left out.
 *
 * BOUNDED, and unable to fail the page: a slow Firestore costs this page its
 * red lamps, never the plan (the lesson of the 2026-09-09 outage — bound any
 * new read-path dependency before awaiting it).
 */
const STOPPAGES_TIMEOUT_MS = 4000;
async function openStoppages(): Promise<{ byMachine: Map<string, Stoppage>; read: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const events = await Promise.race([
      getOpenDowntimeEvents(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("stoppages_timeout")), STOPPAGES_TIMEOUT_MS); }),
    ]);
    const byMachine = new Map<string, Stoppage>();
    for (const e of events) {
      if (e.endedAt != null || (typeof e.resumedAt === "number" && e.resumedAt > 0)) continue;
      const k = machineKey(e.machine);
      const cur = byMachine.get(k);
      // Two open on one machine: the one that started first is how long it has stood.
      if (k && (!cur || e.startedAt < cur.since)) byMachine.set(k, { reason: e.reason, since: e.startedAt });
    }
    return { byMachine, read: true };
  } catch (err) {
    console.error("[changeover] running stoppages not read:", err instanceof Error ? err.message : err);
    return { byMachine: new Map(), read: false };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const logRows = (records: readonly SheetRecord[]): Required<LogRow>[] => records.map((r) => ({
  machine: r.machine || "", order: unquote(r.order), toProduct: r.toProduct || "",
  toColour: r.toColour || "", material: r.material || "", date: r.date || "",
  fromProduct: r.fromProduct || "", nowColour: r.nowColour || "", reasons: r.reasons || "",
}));

/** Which of two open orders for one product is more likely the one running:
 *  «جاري التشغيل» first, then the sooner due date, then the older row. */
function likelierRunning(a: JobShaped, b: JobShaped): number {
  return Number(b.status === "In Production") - Number(a.status === "In Production")
    || (a.dueDate || "9999").localeCompare(b.dueDate || "9999")
    || Number(a.id) - Number(b.id);
}

export async function loadPlan(opts: { fresh?: boolean; role?: Role } = {}): Promise<ChangeoverResponse> {
  const fresh = { fresh: !!opts.fresh };
  const [jobsData, machinesTab, masterTab, prodTab, answersTab, logTab, stops] = await Promise.all([
    // The list needs what is LEFT to make, so «الإنتاج» is joined; downtime is not.
    loadJobs({ downtime: false }),
    getRecords("machines"),
    getRecords("master"),
    // The same read loadJobs makes — one bridge round trip, not two.
    getRecords("production"),
    getRecords("changeoverAnswers", fresh).catch(none),
    getRecords("changeoverLog", fresh).catch(none),
    openStoppages(),
  ]);
  const today = todayIso();

  // A failed read of one of the page's own tabs comes back as an EMPTY tab —
  // and would be served as "nobody has answered anything". A tab that is known
  // not to exist yet is a different, normal thing.
  const plannerRead =
    (answersTab.fields.length > 0 || lazyTabMissing(ANSWERS_TAB))
    && (logTab.fields.length > 0 || lazyTabMissing(LOG_TAB));

  const registry = registryFrom(machinesTab.records);
  const labels = registry.map((m) => m.label);
  const labelOf = new Map(registry.map((m) => [machineKey(m.label), m.label] as const));

  // Product → Master's material, tonnage text and client. First row wins (the
  // rule lib/jobs.ts and the sheet's own VLOOKUP use) — except for a name
  // Master holds twice, where the order's own client picks the twin.
  type MasterRow = { material: string; machine: string; client: string };
  const masterRows = new Map<string, MasterRow[]>();
  // A default for a product Master does not know under that exact name
  // («وش سمارت جديد مباشر» for Master's «وش سمارت مباشر»): the material of the
  // loosely-same name, when every such row agrees on it.
  const looseMaterial = new Map<string, string>();
  for (const m of masterTab.records) {
    const k = nameKey(m.name);
    if (!k) continue;
    const row = { material: m.material || "", machine: m.machine || "", client: (m.client || "").trim() };
    const list = masterRows.get(k);
    if (list) list.push(row); else masterRows.set(k, [row]);
    const lk = looseNameKey(m.name);
    if (lk && row.material) {
      const cur = looseMaterial.get(lk);
      looseMaterial.set(lk, cur === undefined || fold(cur) === fold(row.material) ? row.material : "");
    }
  }
  const master = { get: (k: string): MasterRow | undefined => masterRows.get(k)?.[0] };

  const answers = mergeAnswers(answerRows(answersTab.records));
  const logs = logRows(logTab.records);
  const standing = standingWithStart(logs);

  // What every machine ran in its latest shift. A row with no count yet
  // («لم يُعد بعد») still says which mould was on the machine, so only the
  // day-off markers are left out — NOT isStubRun, which is an OEE rule.
  const shiftRows = prodTab.records.filter((r) => !isDayOffRow(r)).map((r) => ({
    date: normalizeDate(r.date), shift: r.shift || "",
    machine: r.machine || r.machineCode || "", product: r.product || "", material: r.material || "",
    client: (r.client || "").replace(/\s+/g, " ").trim(),
    good: Number(latinDigits(r.goodUnits || "").replace(/[,\s]/g, "")) || 0,
  }));
  const runs = latestRuns(shiftRows, today);
  const holders = newestHolders(shiftRows, today);

  // The material a product was last RUN in — every shift row carries its own
  // «نوع الخام», while Master's is blank for 211 of 546 products.
  const ranIn = new Map<string, { material: string; date: string; rank: number }>();
  for (const r of shiftRows) {
    const k = nameKey(r.product);
    const material = r.material.replace(/\s+/g, " ").trim();
    if (!k || !material || !r.date || r.date > today) continue;
    const rank = shiftRank(r.shift);
    const cur = ranIn.get(k);
    if (!cur || r.date > cur.date || (r.date === cur.date && rank > cur.rank)) ranIn.set(k, { material, date: r.date, rank });
  }
  const materialOf = (product: string): string =>
    master.get(nameKey(product))?.material || ranIn.get(nameKey(product))?.material
    || looseMaterial.get(looseNameKey(product)) || "";

  // «العميل» as the newest shift row of a product ON a machine typed it — what
  // tells two customers' parts of the same name apart, and whose job a machine
  // with no work order is running.
  const clientAt = new Map<string, { client: string; date: string; rank: number }>();
  for (const r of shiftRows) {
    const mk = machineKey(r.machine), pk = fold(r.product);
    if (!mk || !pk || !r.client || !r.date || r.date > today) continue;
    const k = `${mk}|${pk}`, rank = shiftRank(r.shift), cur = clientAt.get(k);
    if (!cur || r.date > cur.date || (r.date === cur.date && rank >= cur.rank)) clientAt.set(k, { client: r.client, date: r.date, rank });
  }

  const openJobs = jobsData.jobs.filter((j) => j.open);
  const codeOf = (j: JobShaped) => j.code.trim() || `#${j.id}`;
  const orderColours = (code: string) => coloursFromSheet(answersFor(answers, "order", codeKey(code)).colour);
  const clientOf = (j: JobShaped) =>
    // A name Master holds twice: the first row may be ANOTHER customer's
    // product — the order's own client cell is the one to believe then.
    (j.ambiguous ? j.client || j.masterClient : j.masterClient || j.client || "").trim();
  const keyClientName = (name: string): boolean =>
    !!fold(name) && parseYesNo(answersFor(answers, "client", fold(name)).keyClient) === true;
  const isKeyClient = (j: JobShaped) => keyClientName(clientOf(j));
  /** The machines the engineer said this order's mould goes on (machine keys). */
  const fitKeys = (j: JobShaped): string[] =>
    listFromSheet(answersFor(answers, "mold", nameKey(j.product)).fits)
      .map((l) => machineMatch(l, labels)).filter((x) => x.matched).map((x) => machineKey(x.label));

  // What a PRODUCT was last made in — nothing in the workbook holds a
  // product's colours, so the page remembers them from what it was told: the
  // colours answered for an order of that product (the newest order wins),
  // else the colours recorded with it on a machine. Only ever a default,
  // shown as one until somebody confirms it for the job in front of them.
  const remembered = new Map<string, string[]>();
  for (const r of logs) {
    const cs = coloursFromSheet(r.toColour).filter((c) => c !== ANY_COLOUR);
    if (cs.length === 0) continue;
    for (const p of listFromSheet(r.toProduct)) { const k = nameKey(p); if (k) remembered.set(k, cs); }
  }
  for (const j of [...jobsData.jobs].sort((a, b) => Number(a.id) - Number(b.id))) {
    const cs = orderColours(j.code).filter((c) => c !== ANY_COLOUR);
    if (cs.length > 0 && nameKey(j.product)) remembered.set(nameKey(j.product), cs);
  }
  const rememberedFor = (products: readonly string[]): string[] => {
    const out: string[] = [];
    for (const p of products) for (const c of remembered.get(nameKey(p)) ?? []) if (!out.includes(c)) out.push(c);
    return out;
  };

  /* ---------------------- machines, pass 1: what stands ---------------------- */

  type Seat = {
    label: string; mk: string; tonnage: string;
    plan: PlanStanding | null;
    base: ReturnType<typeof resolveNow>;
    run: ReturnType<typeof runs.byMachine.get>;
    stoppage: Stoppage | null;
    alsoOn: string;
    /** Somebody recorded on this page, on or after that shift's day, that
     *  EVERY product the shift names stands here — a real pair, already asked. */
    pairTold: boolean;
    /** The latest shift mixes a carried-over product with a new one and nobody
     *  has said which stands: only the NEW one is taken as this machine's. */
    mixedOpen: boolean;
    running: boolean;
    state: PlanMachine["state"];
  };
  const seats: Seat[] = [];
  const seen = new Set<string>();
  for (const m of registry) {
    const mk = machineKey(m.label);
    if (seen.has(mk)) continue; // the registry may list a machine once per product
    seen.add(mk);

    const st = standing.get(mk);
    const row = st?.row;
    const confirmed = st?.started ?? null;
    const run = runs.byMachine.get(mk);
    const plan: PlanStanding | null = row ? {
      date: stampDay(row.date, today),
      products: listFromSheet(row.toProduct),
      colours: coloursFromSheet(row.toColour),
      colourNow: coloursFromSheet(row.nowColour).find((c) => c !== ANY_COLOUR) ?? "",
      order: row.order.trim(),
      material: row.material.trim(),
      baseline: isBaselineRow(row),
      // A note about what stands is only the LAST row: the confirmed change
      // still behind it is what says the machine was started.
      startedOn: confirmed ? stampDay(confirmed.date, today) : "",
      // What came off is true of the shifts up to the day each row said so —
      // the same mould back in a LATER shift is news, not history.
      from: (st?.cameOff ?? []).filter((c) => !run || run.date <= stampDay(c.date, today)).map((c) => c.product),
    } : null;
    // Has the log changed mould SINCE the page was told? Measured from the
    // machine's last shift as of that day for a confirmed change (a change that
    // day is the point) — and as of the day BEFORE for a note about what
    // stands: a change later on the note's own day was read as "unchanged",
    // and the old mould was shown as running for as long as the new one ran.
    // Every shift since is looked at, not only the latest (logSinceTold).
    // A note that sits on a confirm is measured from whichever is LATER: the
    // confirm's own day, or the day before the note.
    const noteAsOf = plan?.date ? daysBefore(plan.date, 1) : "";
    const asOf = !plan?.date ? "" : !plan.baseline ? plan.date : plan.startedOn > noteAsOf ? plan.startedOn : noteAsOf;
    let runAtPlan: ReturnType<typeof runs.byMachine.get> | null = null;
    if (plan && run && asOf) {
      const at = latestRuns(shiftRows, asOf).byMachine.get(mk) ?? null;
      const later = new Map<string, string[]>();
      for (const r of shiftRows) {
        if (machineKey(r.machine) !== mk || !r.date || r.date <= asOf || r.date > today || !fold(r.product)) continue;
        const k = `${r.date}|${shiftRank(r.shift)}`;
        const list = later.get(k);
        if (list) list.push(r.product); else later.set(k, [r.product]);
      }
      const names = plan.products.map(looseNameKey);
      const known = shiftRows.some((r) => machineKey(r.machine) === mk && !!r.date && r.date <= today
        && !!fold(r.product) && names.includes(looseNameKey(r.product)));
      runAtPlan = logSinceTold(plan, at, Array.from(later.values()), run, known) ?? null;
    }
    const base = resolveNow(plan, run ?? null, m.product, runAtPlan ?? null);
    const pairTold = !!plan && !!run && plan.date !== "" && plan.date >= run.date
      && base.products.every((b) => plan.products.some((p) => fold(p) === fold(b)));
    const mixedOpen = !!run?.mixed && base.source === "production" && base.products.length > 1 && !pairTold;
    seats.push({
      label: m.label, mk, tonnage: m.tonnage, plan, base, run, stoppage: stops.byMachine.get(mk) ?? null,
      alsoOn: "", pairTold, mixedOpen, running: false, state: "unknown",
    });
  }

  // Where a mould went by a change CONFIRMED on this page and still standing.
  // The log is typed a day or two behind, so the machine the mould came off
  // keeps "holding" the product by its old shift row until then.
  //
  // A row of the page's log is a MOMENT: its day and its place in the tab. Two
  // rows of one day are told apart by their order (the tab is append-only) — a
  // colour tapped in the morning is not «لسه هنا» said after the mould was
  // mounted on another machine that afternoon.
  type Told = { date: string; at: number };
  type Seen = Told & { machine: string };
  const toldBy = (row: Required<LogRow> | null | undefined): Told =>
    ({ date: row ? stampDay(row.date, today) : "", at: row ? logs.indexOf(row) : -1 });
  const after = (a: Told, b: Told): boolean => a.date > b.date || (a.date === b.date && a.at > b.at);
  const movedByConfirm = new Map<string, Seen>();
  /** The day this machine was started from the page, while that still stands. */
  const startedDay = (s: Seat): string => (!s.plan ? "" : s.plan.baseline ? s.plan.startedOn : s.plan.date);
  for (const s of seats) {
    // The newest confirm behind a machine's row, for as long as the machine
    // still shows that mould — ALSO once its own log has caught up: the machine
    // the mould left may be standing by the page's word, and such a machine is
    // only ever asked through this map (it was asked for one day, until the
    // first shift of the new machine was typed).
    const day = startedDay(s);
    if (!day || !s.plan || (s.base.source !== "plan" && s.base.source !== "production")) continue;
    const me: Seen = { machine: s.mk, date: day, at: toldBy(standing.get(s.mk)?.started).at };
    // Only what the page's row names and the machine still shows — a pair's
    // other half was not "moved".
    for (const p of s.plan.products.filter((x) => s.base.products.some((b) => fold(b) === fold(x)))) {
      const cur = movedByConfirm.get(fold(p));
      if (!cur || after(me, cur)) movedByConfirm.set(fold(p), me);
    }
  }

  for (const s of seats) {
    const { base, run, plan } = s;
    // The same product with a NEWER shift on another machine — or confirmed
    // onto another machine since this one's last shift: the mould has probably
    // moved. Asked, never decided — and not asked again once somebody has
    // recorded on this page, after that, that it is still here.
    // A machine standing by the PAGE's word is asked too, once the same mould
    // is confirmed onto another machine after the row it stands by: its own
    // confirm, or — with no confirm behind it — the note (an order tied under
    // another spelling, a mould that went up after the last logged shift).
    const last = toldBy(standing.get(s.mk)?.row);
    const ownDay = startedDay(s);
    const own: Told | null = ownDay ? { date: ownDay, at: toldBy(standing.get(s.mk)?.started).at } : last.date ? last : null;
    if (base.source === "plan" && own && base.products.length > 0) {
      const movedTo = base.products.map((p) => movedByConfirm.get(fold(p)))
        .filter((c): c is Seen => !!c && c.machine !== s.mk && after(c, own));
      const stillHere = movedTo.every((h) => !after(h, last));
      if (movedTo.length === base.products.length && !stillHere) s.alsoOn = labelOf.get(movedTo[0].machine) ?? "";
    }
    if (base.source === "production" && run && base.products.length > 0) {
      // Per product: the log's evidence first, then the page's.
      const seenOn = base.products.map((p) => {
        const h = holders.get(fold(p));
        const c = movedByConfirm.get(fold(p));
        return [
          h && h.machine !== s.mk && (h.date > run.date || (h.date === run.date && h.rank > shiftRank(run.shift)))
            ? { machine: h.machine, date: h.date, at: -1 } : null,
          c && c.machine !== s.mk && c.date >= run.date ? c : null,
        ].filter((x): x is Seen => !!x);
      });
      const stillHere = !!plan && plan.date !== "" && seenOn.flat().every((h) => !after(h, last))
        && plan.products.some((p) => base.products.some((b) => fold(b) === fold(p)));
      if (seenOn.every((e) => e.length > 0) && !stillHere) s.alsoOn = labelOf.get(seenOn[0][0].machine) ?? "";
    }

    // A stoppage running on the downtime page beats the log; else the log's
    // newest evidence decides (lib/changeover.ts machineState). A mould that
    // has probably left is not "running" here whatever the three-day window says.
    let state = machineState({
      source: base.source, since: base.since, latestDate: runs.latestDate, today, stopped: !!s.stoppage,
    });
    if (s.alsoOn && state === "running") state = "idle";
    s.state = state;
    s.running = state === "running";
  }

  /* -------------------- machines, pass 2: which order is whose -------------------- */

  // ONE order per machine, and one machine per order. A tie the engineer made
  // himself (the order's code on the page's own row) always beats a tie by
  // product name; among name ties the running machine with the newest shift
  // chooses first, and it takes the order most likely to be the running one.
  // Every other open order of the SAME product is not running: it is queued
  // behind that mould (the owner's own case — one product in several colours).
  const tie = new Map<string, Seat>();          // job-code key → the machine it is on
  const jobOf = new Map<string, JobShaped>();   // machine key → its order
  const better = (a: Seat, b: Seat) => Number(a.running) - Number(b.running) || a.base.since.localeCompare(b.base.since);
  const claimable = seats.filter((s) => !s.alsoOn && s.base.products.length > 0);
  // What a machine can be said to hold: everything it shows — except while a
  // mixed shift is unanswered, when the carried-over mould has probably left.
  const held = (s: Seat): string[] => (s.mixedOpen ? s.base.products.slice(0, 1) : s.base.products);
  const seatClient = (s: Seat): string => {
    for (const p of s.run?.products ?? []) { const c = clientAt.get(`${s.mk}|${fold(p)}`); if (c) return c.client; }
    return "";
  };
  // A name Master holds twice is two customers' parts: an order is tied to a
  // machine by NAME only when the shift row's client does not say otherwise.
  const clientAgrees = (j: JobShaped, s: Seat): boolean => {
    if (!j.ambiguous) return true;
    const c = seatClient(s);
    return !c || fold(c) === fold(clientOf(j));
  };
  for (const s of claimable) {
    // An order stays tied by its code only while the machine still shows ITS
    // product (loosely — a tie by another spelling is kept). A row naming a
    // pair with one order used to keep that order "running" after its half
    // had left, and the order was on no list.
    const job = s.base.order ? openJobs.find((j) => codeKey(j.code) && codeKey(j.code) === codeKey(s.base.order)
      && s.base.products.some((p) => looseNameKey(p) === looseNameKey(j.product))) : undefined;
    if (!job) continue;
    const k = codeKey(job.code);
    const cur = tie.get(k);
    if (cur && better(cur, s) >= 0) continue;
    if (cur) jobOf.delete(cur.mk);
    tie.set(k, s); jobOf.set(s.mk, job);
  }
  for (const s of [...claimable].sort((a, b) => better(b, a))) {
    if (jobOf.has(s.mk)) continue;
    const job = openJobs
      .filter((j) => !tie.has(codeKey(codeOf(j))) && held(s).some((p) => nameKey(p) === nameKey(j.product)) && clientAgrees(j, s))
      .sort(likelierRunning)[0];
    if (!job) continue;
    tie.set(codeKey(codeOf(job)), s); jobOf.set(s.mk, job);
  }
  // Where each product's mould stands (a running machine wins a tie).
  const standsOn = new Map<string, Seat>();
  for (const s of claimable) {
    for (const p of held(s)) {
      const k = nameKey(p);
      const cur = k ? standsOn.get(k) : undefined;
      if (k && (!cur || better(s, cur) > 0)) standsOn.set(k, s);
    }
  }

  // A machine running a PAIR has one tied order; ONE order of each other half
  // runs alongside it. A further order of that half is next on its mould —
  // marked running too, it appeared on no list on any machine.
  const alongside = new Map<string, JobShaped>();
  for (const j of [...openJobs].sort(likelierRunning)) {
    if (tie.has(codeKey(codeOf(j)))) continue;
    const h = standsOn.get(nameKey(j.product));
    const lead = h ? jobOf.get(h.mk) : undefined;
    if (!h || !h.running || !lead || !clientAgrees(j, h) || nameKey(lead.product) === nameKey(j.product)) continue;
    const k = `${h.mk}|${nameKey(j.product)}`;
    if (!alongside.has(k)) alongside.set(k, j);
  }

  const machines: PlanMachine[] = seats.map((s) => {
    const { base, run } = s;
    const job = jobOf.get(s.mk);

    // An open order that is PROBABLY this job under another spelling: nothing
    // is tied, the names differ only by a mould number or «جديد» / «قديم» (or
    // it is the other customer's twin name), and exactly one untied order
    // fits. The page asks — unless somebody already answered «لا», or the
    // engineer said that order's mould goes on other machines.
    let maybeJob: JobShaped | undefined;
    // One question at a time: while a mixed shift is unanswered, an answer
    // here would also settle (wrongly) which mould stands.
    if (!job && !s.alsoOn && !s.mixedOpen && base.products.length > 0 && fold(base.order) !== fold(NO_ORDER)) {
      const loose = held(s).map(looseNameKey);
      const maybe = openJobs.filter((j) => {
        if (tie.has(codeKey(codeOf(j))) || !j.code.trim() || !loose.includes(looseNameKey(j.product))) return false;
        const fits = fitKeys(j);
        return fits.length === 0 || fits.includes(s.mk);
      });
      if (maybe.length === 1) maybeJob = maybe[0];
    }

    // The material in the barrel: what the shift row for THAT mould typed
    // (not products[0] of a mixed shift — that may be the mould that came off),
    // then what was recorded here, then Master / the product's last run; and
    // for an order the log spells another way, that mould's own shift row.
    const fromRun = run
      ? base.products.map((p) => run.materials[run.products.findIndex((x) => fold(x) === fold(p))] ?? "").find(Boolean) ?? ""
      : "";
    const spelledAnother = base.source === "plan" && !!run
      && run.products.some((x) => base.products.some((p) => looseNameKey(x) === looseNameKey(p)));
    const material = fromRun || base.material || materialOf(base.products[0] ?? "")
      || (spelledAnother ? run!.materials.find(Boolean) ?? "" : "");

    // Colours, most certain first: the order's own answer, what was recorded
    // with this mould on this machine, what the product was last made in,
    // and last a guess from the names. Only the first two are somebody's tap
    // about THIS job.
    const fromOrder = job ? orderColours(job.code).filter((c) => c !== ANY_COLOUR) : [];
    const told = fromOrder.length > 0 ? fromOrder : base.colours.filter((c) => c !== ANY_COLOUR);
    const fallback = told.length > 0 ? [] : rememberedFor(base.products);
    const guess = told.length > 0 || fallback.length > 0
      ? []
      : [guessColour(base.products) || colourFromMaterial(material)].filter(Boolean);
    const colours = told.length > 0 ? told : fallback.length > 0 ? fallback : guess;
    // The colour in the barrel: what was last told on this page, while it is
    // still one of the job's colours — and, for a job in SEVERAL colours, only
    // until a shift is logged on a later day (nobody tells the page when the
    // run moves from white to black; an old tap must not keep saying "same
    // colour"). Else the only colour there is. "" = the estimate assumes the
    // worst of them, and the confirm asks.
    const toldDay = s.plan?.date ?? "";
    const staleNow = colours.length > 1 && !!run && !!toldDay && run.date > toldDay;
    const colourNow =
      base.colourNow && !staleNow && (colours.length === 0 || colours.includes(base.colourNow)) ? base.colourNow
      : colours.length === 1 ? colours[0]
      : "";

    // Whose job is standing here, when no work order says: the probable
    // order's client, else the shift row's own «العميل», else Master's when the
    // name is held once. A key client's running job is not one to interrupt.
    const onlyMaster = masterRows.get(nameKey(base.products[0] ?? "")) ?? [];
    const standingClient = seatClient(s) || (onlyMaster.length === 1 ? onlyMaster[0].client : "");

    const a = answersFor(answers, "machine", s.mk);
    return {
      label: s.label, tonnage: s.tonnage, state: s.state, stoppage: s.stoppage,
      now: {
        products: base.products, colours, colourNow, coloursGuessed: told.length === 0 && colours.length > 0,
        material, order: job ? codeOf(job) : "",
        keyClient: job ? isKeyClient(job) : maybeJob ? isKeyClient(maybeJob) : keyClientName(standingClient),
        orderMaybe: maybeJob ? maybeJob.code.trim() : "", noOrder: !job && fold(base.order) === fold(NO_ORDER),
        alsoOn: s.alsoOn, mixedShift: s.mixedOpen,
        source: base.source, since: base.since, shift: base.shift,
      },
      transparentOnly: parseYesNo(a.transparentOnly) === true,
      bigMachine: parseYesNo(a.bigMachine) === true,
    };
  });

  /* -------------------------------- orders -------------------------------- */

  const orders: PlanOrder[] = openJobs.map((j) => {
    const code = codeOf(j);
    const client = clientOf(j);
    // A name Master holds twice: the twin of the ORDER's client, or nothing —
    // the first row may be another customer's part, in another material and
    // for another machine.
    const twins = masterRows.get(nameKey(j.product)) ?? [];
    const twin = j.ambiguous && twins.length > 1;
    const std = twin ? twins.find((r) => fold(r.client) === fold(j.client)) : twins[0];
    const oa = answersFor(answers, "order", codeKey(code));
    const ma = answersFor(answers, "mold", nameKey(j.product));
    const material = twin ? std?.material ?? "" : j.material || materialOf(j.product);

    const answered = coloursFromSheet(oa.colour);
    let guess: string[] = [];
    if (answered.length === 0) {
      if (colourKey(j.masterbatch) === ANY_COLOUR) guess = [ANY_COLOUR];
      else {
        // The order's own words first («اللون ابيض ماستر 4٪»), then what the
        // product was last made in, then its name, then its material.
        const said = guessColour([j.instructions, j.notes, j.masterbatch]);
        const before = said ? [] : rememberedFor([j.product]);
        const named = said || before.length > 0 ? "" : guessColour([j.product]) || colourFromMaterial(material);
        guess = said ? [said] : before.length > 0 ? before : named ? [named] : [];
      }
    }

    const fits = listFromSheet(ma.fits).map((l) => machineMatch(l, labels)).filter((x) => x.matched).map((x) => x.label);
    const tons = tonnagesIn(std?.machine);

    // Tied to a machine → that is where it is, running or standing. Not tied
    // but its mould is up somewhere: it is queued behind the order running on
    // that SAME mould, or — when the machine runs a pair and the order ahead
    // is the other half's — it is running alongside it.
    const seat = tie.get(codeKey(code));
    const stands = seat ? undefined : standsOn.get(nameKey(j.product));
    const holder = stands && clientAgrees(j, stands) ? stands : undefined;
    const ahead = holder ? jobOf.get(holder.mk) : undefined;
    const sameMould = !!ahead && nameKey(ahead.product) === nameKey(j.product);
    const lead = holder ? alongside.get(`${holder.mk}|${nameKey(j.product)}`) : undefined;
    // The order this one waits behind on its own mould: the tied one, or the
    // one of its half that is running alongside.
    const behind = sameMould ? ahead : lead && lead !== j ? lead : undefined;

    // What is left. lib/jobs.ts counts shifts by the order's exact name; an
    // order the engineer tied to a machine whose log spells the product
    // another way («كفر شفاف فوكس 2») has been made there too — without this
    // its «الباقي» froze on the day of the tie and never reached "finished".
    // The credit follows the TIE (the order's code on the page's row), not
    // the spelling of the latest shift — or «الباقي» jumped back up by the
    // whole amount the day one shift was typed under the order's own name.
    let remaining = j.qtyOrdered > 0 ? j.remaining : null;
    if (remaining !== null && seat && !!codeKey(seat.base.order) && codeKey(seat.base.order) === codeKey(code)) {
      const own = nameKey(j.product), loose = looseNameKey(j.product);
      // …and only a spelling this machine has been LOGGED under while the tie
      // has stood: a sibling that ran here before this order was mounted, or
      // one running beside it, is another product, not another spelling.
      let first: Required<LogRow> | null = null; // the row that began this tie
      for (let i = logs.length - 1; i >= 0; i--) {
        const r = logs[i];
        if (machineKey(r.machine) !== seat.mk || !r.toProduct.trim()) continue;
        if (codeKey(r.order) !== codeKey(code)) break;
        first = r;
      }
      const day = first ? stampDay(first.date, today) : "";
      // A note describes what was already running (from the last shift before
      // it); a confirmed change starts with the shifts after its day.
      const from = !first || !day ? ""
        : isBaselineRow(first) ? latestRuns(shiftRows, daysBefore(day, 1)).byMachine.get(seat.mk)?.date ?? day
        : daysBefore(day, -1);
      const mine = shiftRows.filter((r) => machineKey(r.machine) === seat.mk && !!r.date && r.date <= today);
      const slot = (r: { date: string; shift: string }) => `${r.date}|${shiftRank(r.shift)}`;
      const withOwn = new Set(mine.filter((r) => nameKey(r.product) === own).map(slot));
      const spelled = new Set(mine
        .filter((r) => !!from && r.date >= from && nameKey(r.product) !== own && looseNameKey(r.product) === loose && !withOwn.has(slot(r)))
        .map((r) => nameKey(r.product)));
      const extra = mine
        .filter((r) => spelled.has(nameKey(r.product)) && (!j.startDate || r.date >= j.startDate))
        .reduce((sum, r) => sum + r.good, 0);
      remaining = Math.max(0, remaining - extra);
    }
    // Hours of running left: Master's cycle and cavities when it has them,
    // else the order's own logged rate (only shifts with a COUNT — a
    // «لم يُعد بعد» row would understate it).
    let runHours: number | null = null;
    if (remaining !== null && j.cycleSec > 0 && j.cavities > 0) {
      runHours = Math.round((remaining * j.cycleSec * 10) / (3600 * j.cavities)) / 10;
    } else if (remaining !== null) {
      const counted = jobsData.runsFor(j).filter((r) => r.goodUnits > 0);
      const made = counted.reduce((sum, r) => sum + r.goodUnits, 0);
      if (counted.length > 0 && made > 0) runHours = Math.round((remaining / (made / counted.length)) * 12 * 10) / 10;
    }
    const workers = Number(latinDigits(ma.workers ?? ""));

    return {
      id: j.id, code, product: j.product, client,
      material, dueDate: j.dueDate, status: j.status, qtyKg: j.qtyOrderedKg,
      remaining, runHours,
      colours: answered.length > 0 ? answered : guess,
      colourSource: answered.length > 0 ? "answer" : guess.length > 0 ? "guess" : "",
      fits: fits.length > 0 ? fits : null,
      fitsHint: tons.length ? registry.filter((m) => tons.includes(m.tonnage)).map((m) => m.label)
        .filter((l, i, arr) => arr.indexOf(l) === i) : [],
      fitsHintText: tons.join(" / "),
      workers: workers > 0 ? workers : null,
      oilCores: parseYesNo(ma.oilCores),
      hotRunner: parseYesNo(ma.hotRunner),
      missing: missingFromSheet(oa.missing),
      keyClient: isKeyClient(j),
      mountedOn: seat?.label ?? holder?.label ?? "",
      mountedRunning: !!seat?.running || (!!holder?.running && !!ahead && !behind),
      queuedBehind: holder?.running && behind ? codeOf(behind) : "",
    };
  });

  // The map: only machines the registry still has, in the registry's spelling.
  const layout: MapTile[] = [];
  for (const t of parseLayout(answersFor(answers, "map", keyFor("map", MAP_NAME)).layout)) {
    const m = machineMatch(t.label, labels);
    if (m.matched) layout.push({ ...t, label: m.label });
  }

  // The page's own two tabs count too: an answer saved a minute ago and not
  // yet in the served copy is exactly what "numbers from X ago" is for.
  const readAt = Math.min(jobsData.readAt, machinesTab.readAt, masterTab.readAt, prodTab.readAt, answersTab.readAt, logTab.readAt);
  return {
    ok: true,
    configured: jobsData.configured,
    writable: sheetsWritable(),
    today,
    logDate: runs.latestDate,
    logRead: shiftRows.length > 0,
    masterRead: masterTab.records.length > 0,
    plannerRead,
    night: isNightHour(cairoHour()),
    canSetKeyClient: !!opts.role && hasFullAccess(opts.role),
    keyClients: Array.from(answers.entries()).filter(([k, v]) => k.startsWith("client:") && parseYesNo(v.keyClient) === true).length,
    machines, orders,
    layout: validLayout(layout) ? layout : [],
    stoppagesRead: stops.read,
    dataAgeMs: Math.max(0, Date.now() - readAt),
  };
}

/* --------------------------------- writing -------------------------------- */

/**
 * A NAME on its way into a cell. Every append is typed in as if by hand
 * (USER_ENTERED on the Sheets API), so a job code like «1/1/26» — the factory
 * has those — would be stored as a DATE and never match its order again. A
 * leading apostrophe is how a person forces text; it is stripped on the way
 * back (`unquote`). Only added when the text could be read as a number or a
 * date, so ordinary names stay exactly as they are.
 */
const textCell = (v: string): string => (/^[\d\s./:\-]+$/.test(v) && /\d/.test(v) ? `'${v}` : v);

/** Append, creating the tab on a `no_tab` answer — the shape «طلبات العملاء» uses. */
async function appendLazy(entity: "changeoverAnswers" | "changeoverLog", values: Record<string, string>): Promise<UpdateResult> {
  let res = await appendRecord(entity, values);
  if (!res.ok && res.reason === "no_tab") {
    const made = entity === "changeoverAnswers"
      ? await ensureTab(ANSWERS_TAB, ANSWERS_HEADERS)
      : await ensureTab(LOG_TAB, LOG_HEADERS);
    if (!made.ok) return made;
    res = await appendRecord(entity, values);
  }
  return res;
}

/**
 * A column that was added to a tab AFTER the tab existed («ترتيب الخريطة»,
 * «هوت رانر», «اللون الشغال الآن»). An append silently DROPS a value whose
 * header the tab does not have, so the header is made sure of first — a no-op
 * once it is there; `no_tab` means the append creates the tab with them all.
 */
async function ensureColumns(entity: "changeoverAnswers" | "changeoverLog"): Promise<boolean> {
  const res = await ensureHeaders(entity, entity === "changeoverAnswers" ? ANSWERS_HEADERS : LOG_HEADERS);
  if (res.ok || res.reason === "no_tab") return true;
  console.error(`[changeover] could not add a column to ${entity}: ${res.reason}`);
  return false;
}

/**
 * Did an answer that LOOKED refused land anyway? The bridge is at-least-once:
 * on the first live save (2026-10-01) it created the tab, wrote the row and
 * answered 404, and the page told the engineer «تعذّر الحفظ» about a row that
 * was sitting in the sheet. A failed-looking write is not evidence that
 * nothing happened — so read the tab fresh and see whether the standing
 * answer for that thing now says what was sent.
 */
async function answerLanded(kind: AnswerKind, row: Record<string, string>): Promise<boolean> {
  try {
    const tab = await getRecords("changeoverAnswers", { fresh: true });
    const standing = answersFor(mergeAnswers(answerRows(tab.records)), kind, keyFor(kind, unquote(row.name)));
    const cols = (Object.keys(ANSWER_COLUMNS) as AnswerColumn[]).filter((c) => row[c]);
    return cols.length > 0 && cols.every((c) => fold(standing[c]) === fold(row[c]));
  } catch {
    return false;
  }
}

export type AnswerItem = { kind: string; name: string; values: Record<string, unknown> };
export type SaveResult = { ok: true; saved: number } | { ok: false; reason: string; status: number };

const refuse = (reason: string, status = 400): SaveResult => ({ ok: false, reason, status });

/** Colour keys from what a form sends — a list, or one word. Unknown → "". */
function colourKeys(raw: unknown, max = 8): string[] {
  const list = Array.isArray(raw) ? raw : [raw];
  const keys: string[] = [];
  for (const x of list.slice(0, max)) {
    const k = colourKey(safeText(x, 40));
    if (k && !keys.includes(k)) keys.push(k);
  }
  return keys;
}
/** …and as the cell they become. safeText runs LAST, on the finished text:
 *  colourKey folds invisible characters away, and a «=» that was hiding
 *  behind one must not reach the sheet as the first character of a cell. */
const colourCell = (keys: readonly string[]): string => safeText(coloursToSheet(keys), 200);

/**
 * Save what the engineer answered — one row per (kind, name).
 *
 * Every NAME is checked against the sheet it belongs to and written in that
 * sheet's own spelling, never the request's: a machine must be a registry
 * label, an order a job code, a mould a product an open order or Master
 * names, a client the client of some order; the map has one name. A column
 * asked about the wrong kind of thing is refused, and «عميل مهم» is the
 * owner's and a manager's.
 */
export async function saveAnswers(items: readonly AnswerItem[], by: string, role: Role): Promise<SaveResult> {
  if (!sheetsWritable()) return refuse("not_writable", 503);
  if (!Array.isArray(items) || items.length === 0 || items.length > 6) return refuse("bad_items");

  const [machinesTab, jobsTab, masterTab] = await Promise.all([
    getRecords("machines"), getRecords("jobs"), getRecords("master"),
  ]);
  const labels = registryFrom(machinesTab.records).map((m) => m.label);
  // A name can only be checked against a sheet that was actually read: a
  // failed read is an empty tab, and would refuse every machine as "not in
  // the registry any more".
  if (labels.length === 0 || jobsTab.records.length === 0) return refuse("sheet_unreadable", 503);

  const rows: { kind: AnswerKind; row: Record<string, string> }[] = [];
  for (const it of items) {
    const kind = kindFromSheet(it?.kind);
    const asked = safeText(it?.name, 160);
    if (!kind || (!asked && kind !== "map")) return refuse("bad_item");

    let name = "";
    if (kind === "map") {
      name = MAP_NAME;
    } else if (kind === "machine") {
      const m = machineMatch(asked, labels);
      if (!m.matched) return refuse("unknown_machine");
      name = m.label;
    } else if (kind === "order") {
      const hit = jobsTab.records.find((r) => codeKey(r.code) && codeKey(r.code) === codeKey(asked));
      if (!hit) return refuse("unknown_order");
      name = textCell(safeText(hit.code, 160));
    } else if (kind === "mold") {
      const k = nameKey(asked);
      const hit = masterTab.records.find((r) => nameKey(r.name) === k)?.name
        ?? jobsTab.records.find((r) => nameKey(r.product) === k)?.product;
      if (!k || !hit) return refuse("unknown_product");
      name = textCell(safeText(hit.replace(/\s+/g, " "), 160));
    } else {
      const k = fold(asked);
      const hit = masterTab.records.find((r) => fold(r.client) === k)?.client
        ?? jobsTab.records.find((r) => fold(r.client) === k)?.client;
      if (!k || !hit) return refuse("unknown_client");
      name = textCell(safeText(hit.replace(/\s+/g, " "), 160));
    }

    const row: Record<string, string> = { date: cairoStamp(), kind: kindToSheet(kind), name, by };
    let any = false;
    for (const [col, raw] of Object.entries(it.values ?? {})) {
      if (!(col in ANSWER_COLUMNS)) return refuse("bad_column");
      const c = col as AnswerColumn;
      if (ANSWER_COLUMNS[c] !== kind) return refuse("bad_column");
      let cell = "";
      switch (c) {
        case "colour": {
          cell = colourCell(colourKeys(raw));
          if (!cell) return refuse("bad_colour");
          break;
        }
        case "missing": {
          if (!Array.isArray(raw)) return refuse("bad_missing");
          const known = MISSING_ITEMS.map((m) => m.key as string);
          cell = missingToSheet(raw.map(String).filter((x) => known.includes(x)));
          break;
        }
        case "fits": {
          // An empty list takes the answer back («غير محدد»): every machine
          // was un-tapped, and the latest non-blank cell is what stands.
          if (!Array.isArray(raw)) return refuse("bad_fits");
          const out: string[] = [];
          for (const l of raw) {
            const m = machineMatch(String(l), labels);
            if (!m.matched) return refuse("unknown_machine");
            if (!out.includes(m.label)) out.push(m.label);
          }
          cell = out.length > 0 ? listToSheet(out) : FITS_UNKNOWN;
          break;
        }
        case "workers": {
          const n = Number(raw);
          if (!Number.isInteger(n) || n < 1 || n > 9) return refuse("bad_workers");
          cell = String(n);
          break;
        }
        case "layout": {
          // Every tile names a registry machine, in the registry's spelling;
          // whole cells, inside the grid, no two on one spot.
          if (!Array.isArray(raw) || raw.length === 0 || raw.length > 60) return refuse("bad_layout");
          const tiles: MapTile[] = [];
          for (const t of raw as Record<string, unknown>[]) {
            const m = machineMatch(String(t?.label ?? ""), labels);
            if (!m.matched) return refuse("unknown_machine");
            tiles.push({ label: m.label, c: Number(t.c), r: Number(t.r), w: Number(t.w), h: Number(t.h) });
          }
          if (tiles.some((t) => ![t.c, t.r, t.w, t.h].every(Number.isInteger)) || !validLayout(tiles)) return refuse("bad_layout");
          cell = formatLayout(tiles);
          break;
        }
        case "keyClient":
        case "oilCores":
        case "hotRunner":
        case "transparentOnly":
        case "bigMachine":
          if (c === "keyClient" && !hasFullAccess(role)) return refuse("forbidden", 403);
          if (typeof raw !== "boolean") return refuse("bad_yes_no");
          cell = yesNo(raw);
          break;
      }
      row[c] = cell;
      any = true;
    }
    if (!any) return refuse("nothing_to_save");
    rows.push({ kind, row });
  }

  if (rows.some((r) => r.row.layout || r.row.hotRunner) && !(await ensureColumns("changeoverAnswers"))) {
    return refuse("save_failed", 503);
  }

  let saved = 0;
  for (const { kind, row } of rows) {
    const res = await appendLazy("changeoverAnswers", row);
    if (!res.ok && !(await answerLanded(kind, row))) {
      console.error(`[changeover] answer append failed: ${res.reason}`);
      return { ok: false, reason: saved > 0 ? "partly_saved" : "save_failed", status: 503 };
    }
    saved++;
  }
  return { ok: true, saved };
}

export type MountInput = {
  machine: string;
  /** The work order going on; "" for «الراكب الآن» with no order behind it. */
  order: string;
  /** What stands on the machine — one product, sometimes a pair. */
  products: string[];
  /** The colours the job is made in. */
  colours: string[];
  /** The ONE colour in the barrel — what a change starts on, or what is running. */
  colourNow: string;
  /** What the page showed as standing before — the log's "from" columns. */
  fromProducts: string[];
  fromColours: string[];
  minutes: number;
  reasons: string;
  /** true = "this is what is standing on the machine now" — the log row only. */
  baseline: boolean;
  /** With `baseline` and no order: the answer «لا» to "is this work order …?"
   *  — recorded so the page stops asking (lib/changeover.ts NO_ORDER). */
  noOrder?: boolean;
};

/** What happened to each of the three writes; the page says all three. */
export type WriteOutcome = "written" | "unchanged" | "skipped" | "failed";
export type MountResult =
  | { ok: true; replay: boolean; job: WriteOutcome; jobNote: string; registry: WriteOutcome; registryNote: string }
  | { ok: false; reason: string; status: number };

const cleanList = (list: unknown, max = 160): string[] =>
  (Array.isArray(list) ? list : []).slice(0, 6).map((x) => safeText(x, max).replace(/\s+/g, " ")).filter(Boolean);

/** A second identical save inside this window is the first one arriving
 *  twice; after it, the same job going back up is a NEW row. */
const REPLAY_WINDOW_MIN = 10;

/**
 * Record a mould going onto a machine — or what is standing on it now.
 *
 * ONE row in «تغييرات الاسطمبات» is the record; the order's machine cell and
 * the registry's product cell follow it, each reported on its own — a change
 * that IS in the log must never be reported as failed because a second cell
 * was refused. The bridge is at-least-once, so the log is read fresh first
 * and a row that already says exactly this, minutes ago, is a replay, not a
 * second change.
 */
export async function recordMount(input: MountInput, by: string): Promise<MountResult> {
  const fail = (reason: string, status = 400): MountResult => ({ ok: false, reason, status });
  if (!sheetsWritable()) return fail("not_writable", 503);

  const [machinesTab, jobsTab, masterTab, logTab] = await Promise.all([
    getRecords("machines"), getRecords("jobs"), getRecords("master"),
    getRecords("changeoverLog", { fresh: true }).catch(none),
  ]);
  const registry = registryFrom(machinesTab.records);
  // Nothing is checked against a sheet that was not read (a failed read is an
  // empty tab): no machine would match, and a named order would look deleted.
  if (registry.length === 0 || jobsTab.records.length === 0) return fail("sheet_unreadable", 503);
  const mm = machineMatch(input.machine, registry.map((m) => m.label));
  if (!mm.matched) return fail("unknown_machine");
  const mk = machineKey(mm.label);

  // The order, when one is named: it must exist, and for a real change it
  // must still be open — and its product is the sheet's, never the request's.
  const want = codeKey(input.order);
  const jobRows = want ? jobsTab.records.filter((r) => codeKey(r.code) === want) : [];
  if (want && jobRows.length === 0) return fail("unknown_order");
  // A note that names something that came off and does not name the order's
  // own product as standing is not about that order: «اتغيّرت» on a machine
  // whose tied order belonged to the OLD mould wrote the old mould as standing.
  const found = jobRows[0];
  const foundOwn = found ? (found.product || "").replace(/\s+/g, " ").trim() : "";
  const job = input.baseline && found && cleanList(input.fromProducts).length > 0
    && !cleanList(input.products).some((x) => fold(x) === fold(foundOwn)) ? undefined : found;
  if (job && !input.baseline && !isOpenOrder(job.status)) return fail("order_closed");

  // The order's product is the sheet's, never the request's. A note about
  // what STANDS may name the rest of a pair beside it — but only beside it.
  const own = job ? (job.product || "").replace(/\s+/g, " ").trim() : "";
  const sent = cleanList(input.products);
  const products = !job ? sent
    : input.baseline && own && sent.some((x) => fold(x) === fold(own)) ? [own, ...sent.filter((x) => fold(x) !== fold(own))]
    : [own].filter(Boolean);
  if (products.length === 0) return fail("no_product");
  const fromCell = safeText(listToSheet(cleanList(input.fromProducts)), 400);
  const orderCell = job ? textCell(safeText(job.code, 160)) : input.baseline && input.noOrder ? NO_ORDER : "";
  const wantOrder = job ? want : codeKey(orderCell);
  const productCell = safeText(listToSheet(products), 400);
  const setKeys = colourKeys(input.colours);
  const nowKey = colourKeys([input.colourNow]).find((k) => k !== ANY_COLOUR) ?? "";
  const setCell = colourCell(setKeys.length > 0 ? setKeys : nowKey ? [nowKey] : []);
  const nowCell = nowKey ? safeText(colourToSheet(nowKey), 40) : "";
  const reasons = input.baseline ? BASELINE_REASON : safeText(input.reasons, 300);
  const masterRow = masterTab.records.find((r) => nameKey(r.name) === nameKey(products[0]));
  const stamp = cairoStamp();

  const says = (row: Required<LogRow> | undefined): boolean =>
    !!row && fold(row.toProduct) === fold(productCell) && codeKey(row.order) === wantOrder
    && fold(row.fromProduct) === fold(fromCell)
    && fold(coloursToSheet(coloursFromSheet(row.toColour))) === fold(setCell)
    && fold(coloursToSheet(coloursFromSheet(row.nowColour))) === fold(nowCell)
    && isBaselineRow(row) === input.baseline;
  /** …and it was written minutes ago, not last week. Both stamps on ONE clock,
   *  read the way loadPlan reads them (stampDay) — not day-first. */
  const recent = (row: Required<LogRow> | undefined): boolean => {
    const then = stampClockMinutes(row?.date), now = stampClockMinutes(stamp);
    return then !== null && now !== null && now - then >= 0 && now - then <= REPLAY_WINDOW_MIN;
  };

  const last = standingFromLog(logRows(logTab.records)).get(mk);
  const replay = says(last) && recent(last);
  if (!replay) {
    if (nowCell && !(await ensureColumns("changeoverLog"))) return fail("save_failed", 503);
    const res = await appendLazy("changeoverLog", {
      date: stamp,
      machine: mm.label,
      fromProduct: fromCell,
      fromColour: colourCell(colourKeys(input.fromColours)),
      order: orderCell,
      toProduct: productCell,
      toColour: setCell,
      nowColour: nowCell,
      material: masterRow?.material || "",
      minutes: input.baseline || !Number.isFinite(input.minutes) ? "" : String(Math.max(0, Math.round(input.minutes))),
      reasons,
      by,
    });
    if (!res.ok) {
      // Same at-least-once check as the answers: the row may be there.
      const after = standingFromLog(logRows((await getRecords("changeoverLog", { fresh: true }).catch(none)).records)).get(mk);
      if (!says(after) || !recent(after)) {
        console.error(`[changeover] log append failed: ${res.reason}`);
        return fail("save_failed", 503);
      }
    }
  }

  let jobOut: WriteOutcome = "skipped", jobNote = "";
  let regOut: WriteOutcome = "skipped", regNote = "";
  if (input.baseline) return { ok: true, replay, job: jobOut, jobNote: "baseline", registry: regOut, registryNote: "baseline" };

  const canExpect = await expectSupported();

  // «أوامر العمل»!G — the order's machine, in the registry's own spelling.
  if (!job) jobNote = "no_order";
  else if (jobRows.length > 1) jobNote = "duplicate_code";
  else if (machineKey(job.machine) === mk) { jobOut = "unchanged"; }
  else {
    const copy = canExpect ? job : (await getRecords("jobs", { fresh: true })).records.find((r) => r.row === job.row);
    if (!copy || codeKey(copy.code) !== want) { jobOut = "failed"; jobNote = "row_changed"; }
    else {
      const res = await updateRecord("jobs", job.row, { machine: mm.label },
        canExpect ? { expect: { field: "code", value: job.code } } : {});
      jobOut = res.ok ? "written" : "failed";
      jobNote = res.ok ? "" : res.reason ?? "";
    }
  }

  // «الماكينات»!C — the product standing in the machine. The cell is a
  // dropdown of Master's names, so only Master's exact spelling is written;
  // a machine the registry lists twice (one row per product) is left alone.
  const regRows = registry.filter((m) => machineKey(m.label) === mk);
  if (regRows.length > 1) regNote = "machine_listed_twice";
  else if (!masterRow?.name) regNote = "product_not_in_master";
  else if (nameKey(regRows[0].product) === nameKey(masterRow.name)) regOut = "unchanged";
  else {
    const r0 = regRows[0];
    const copy = canExpect ? r0 : registryFrom((await getRecords("machines", { fresh: true })).records).find((m) => m.row === r0.row);
    if (!copy || machineKey(copy.label) !== mk) { regOut = "failed"; regNote = "row_changed"; }
    else {
      const res = await updateRecord("machines", r0.row, { product: masterRow.name },
        canExpect && r0.code ? { expect: { field: "code", value: r0.code } } : {});
      regOut = res.ok ? "written" : "failed";
      regNote = res.ok ? "" : res.reason ?? "";
    }
  }

  return { ok: true, replay, job: jobOut, jobNote, registry: regOut, registryNote: regNote };
}
