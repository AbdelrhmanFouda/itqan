import {
  getRecords, appendRecord, ensureHeaders, ensureTab, updateRecord, expectSupported, sheetsWritable,
  type SheetRecord, type UpdateResult,
} from "@/lib/sheets";
import { loadJobs } from "@/lib/jobs";
import { nameKey } from "@/lib/master-lookup";
import { codeKey, machineMatch } from "@/lib/work-orders";
import { latinDigits, normalizeDate, todayIso } from "@/lib/dates";
import { cairoStamp, canonicalStamp } from "@/lib/customer-requests";
import { isDayOffRow } from "@/lib/run-join";
import { hasFullAccess, type Role } from "@/lib/roles";
import {
  ANSWERS_HEADERS, ANSWERS_TAB, LOG_HEADERS, LOG_TAB, ANSWER_COLUMNS, ANY_COLOUR, MAP_NAME, MISSING_ITEMS,
  answersFor, colourKey, coloursFromSheet, coloursToSheet, fold, formatLayout, guessColour, isNightHour,
  isRecent, kindFromSheet, kindToSheet, latestRuns, listFromSheet, listToSheet, machineKey, mergeAnswers,
  missingFromSheet, missingToSheet, parseLayout, parseYesNo, resolveNow, safeText, standingFromLog,
  validLayout, yesNo,
  type AnswerColumn, type AnswerKind, type AnswerRow, type MachineState, type MapTile, type PlanMachine,
  type PlanOrder, type PlanStanding,
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
 *        «الرئيسي», and the page's own two tabs.
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
  /** 20:00–08:00 Cairo: no mould changes and no samples on the night shift. */
  night: boolean;
  /** Only the owner and a manager mark a client as important. */
  canSetKeyClient: boolean;
  machines: PlanMachine[];
  orders: PlanOrder[];
  /** The floor map, as arranged on the page; [] until somebody arranges it. */
  layout: MapTile[];
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

function answerRows(records: readonly SheetRecord[]): AnswerRow[] {
  return records.map((r) => {
    const kind = kindFromSheet(r.kind);
    const row: AnswerRow = { kind, key: kind ? keyFor(kind, r.name || "") : "" };
    for (const col of Object.keys(ANSWER_COLUMNS) as AnswerColumn[]) row[col] = r[col] || "";
    return row;
  });
}

const logRows = (records: readonly SheetRecord[]) => records.map((r) => ({
  machine: r.machine || "", order: r.order || "", toProduct: r.toProduct || "",
  toColour: r.toColour || "", material: r.material || "", date: r.date || "",
}));

export async function loadPlan(opts: { fresh?: boolean; role?: Role } = {}): Promise<ChangeoverResponse> {
  const fresh = { fresh: !!opts.fresh };
  const [jobsData, machinesTab, masterTab, prodTab, answersTab, logTab] = await Promise.all([
    // The list needs what is LEFT to make, so «الإنتاج» is joined; downtime is not.
    loadJobs({ downtime: false }),
    getRecords("machines"),
    getRecords("master"),
    // The same read loadJobs makes — one bridge round trip, not two.
    getRecords("production"),
    getRecords("changeoverAnswers", fresh).catch(none),
    getRecords("changeoverLog", fresh).catch(none),
  ]);
  const today = todayIso();

  const registry = registryFrom(machinesTab.records);
  const labels = registry.map((m) => m.label);

  // Product → Master's material and tonnage text, first row wins (the same
  // rule lib/jobs.ts and the sheet's own VLOOKUP use).
  const master = new Map<string, { material: string; machine: string }>();
  for (const m of masterTab.records) {
    const k = nameKey(m.name);
    if (k && !master.has(k)) master.set(k, { material: m.material || "", machine: m.machine || "" });
  }

  const answers = mergeAnswers(answerRows(answersTab.records));
  const standing = standingFromLog(logRows(logTab.records));

  // What every machine ran in its latest shift. A row with no count yet
  // («لم يُعد بعد») still says which mould was on the machine, so only the
  // day-off markers are left out — NOT isStubRun, which is an OEE rule.
  const shiftRows = prodTab.records.filter((r) => !isDayOffRow(r)).map((r) => ({
    date: normalizeDate(r.date), shift: r.shift || "",
    machine: r.machine || r.machineCode || "", product: r.product || "",
  }));
  const runs = latestRuns(shiftRows, today);

  const openJobs = jobsData.jobs.filter((j) => j.open);
  const orderColours = (code: string) => coloursFromSheet(answersFor(answers, "order", codeKey(code)).colour);

  // What a PRODUCT was last made in — nothing in the workbook holds a
  // product's colours, so the page remembers them from what it was told: the
  // colours answered for an order of that product (the newest order wins),
  // else the colours recorded with it on a machine. Only ever a default,
  // shown as one until somebody confirms it for the job in front of them.
  const remembered = new Map<string, string[]>();
  for (const r of logRows(logTab.records)) {
    const cs = coloursFromSheet(r.toColour);
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

  /* ------------------------------- machines ------------------------------- */

  const machines: PlanMachine[] = [];
  const seen = new Set<string>();
  // product key → the machine it stands on (a running machine wins a tie).
  const standsOn = new Map<string, { label: string; running: boolean }>();
  const orderOn = new Map<string, { label: string; running: boolean }>();
  for (const m of registry) {
    const mk = machineKey(m.label);
    if (seen.has(mk)) continue; // the registry may list a machine once per product
    seen.add(mk);

    const st = standing.get(mk);
    const plan: PlanStanding | null = st ? {
      date: canonicalStamp(st.date).slice(0, 10) || normalizeDate(st.date),
      products: listFromSheet(st.toProduct),
      colours: coloursFromSheet(st.toColour),
      order: st.order.trim(),
      material: st.material.trim(),
    } : null;
    const run = runs.byMachine.get(mk) ?? null;
    // The machine's last shift as of the confirm's day — whether the log has
    // changed mould SINCE is what decides if the confirm still stands.
    const runAtPlan = plan && run && plan.date ? latestRuns(shiftRows, plan.date).byMachine.get(mk) ?? null : null;
    const base = resolveNow(plan, run, m.product, runAtPlan);

    // Running = the newest evidence (a logged shift, or a change confirmed
    // here) is within a day of the newest date the log holds — or of today,
    // for a mould that went up after the log was last typed.
    const state: MachineState =
      base.source === "plan" || base.source === "production"
        ? (isRecent(base.since, runs.latestDate) || isRecent(base.since, today) ? "running" : "idle")
        : "unknown";

    // The work order behind it: the one confirmed here, else the open order
    // for the same product — the product name is the only link there is.
    const job = openJobs.find((j) => base.order && codeKey(j.code) === codeKey(base.order))
      ?? openJobs.find((j) => base.products.some((p) => nameKey(p) === nameKey(j.product)));
    const order = job ? (job.code.trim() || `#${job.id}`) : "";

    const material = base.material || master.get(nameKey(base.products[0]))?.material || "";
    // Colours, most certain first: the order's own answer, what was recorded
    // with this mould on this machine, what the product was last made in,
    // and last a guess from the names. Only the first two are somebody's tap
    // about THIS job.
    const fromOrder = job ? orderColours(job.code).filter((c) => c !== ANY_COLOUR) : [];
    const told = fromOrder.length > 0 ? fromOrder : base.colours;
    const fallback = told.length > 0 ? [] : rememberedFor(base.products);
    const guess = told.length > 0 || fallback.length > 0 ? [] : [guessColour([...base.products, material])].filter(Boolean);
    const colours = told.length > 0 ? told : fallback.length > 0 ? fallback : guess;
    const coloursGuessed = told.length === 0 && colours.length > 0;
    const colourNow = base.colours.length === 1 ? base.colours[0] : colours.length === 1 ? colours[0] : "";

    const where = { label: m.label, running: state === "running" };
    for (const p of base.products) {
      const k = nameKey(p);
      if (k && (!standsOn.has(k) || (where.running && !standsOn.get(k)!.running))) standsOn.set(k, where);
    }
    if (order) orderOn.set(codeKey(order), where);

    const a = answersFor(answers, "machine", mk);
    machines.push({
      label: m.label, tonnage: m.tonnage, state,
      now: {
        products: base.products, colours, colourNow, coloursGuessed, material, order,
        source: base.source, since: base.since, shift: base.shift,
      },
      transparentOnly: parseYesNo(a.transparentOnly) === true,
      bigMachine: parseYesNo(a.bigMachine) === true,
    });
  }

  /* -------------------------------- orders -------------------------------- */

  const orders: PlanOrder[] = openJobs.map((j) => {
    const code = j.code.trim() || `#${j.id}`;
    const client = (j.masterClient || j.client || "").trim();
    const std = master.get(nameKey(j.product));
    const oa = answersFor(answers, "order", codeKey(code));
    const ma = answersFor(answers, "mold", nameKey(j.product));
    const ca = answersFor(answers, "client", fold(client));

    const answered = coloursFromSheet(oa.colour);
    let guess: string[] = [];
    if (answered.length === 0) {
      if (colourKey(j.masterbatch) === ANY_COLOUR) guess = [ANY_COLOUR];
      else {
        // The order's own words first («اللون ابيض ماستر 4٪»), then what the
        // product was last made in, then its name and material.
        const said = guessColour([j.instructions, j.notes, j.masterbatch]);
        const before = said ? [] : rememberedFor([j.product]);
        const named = said || before.length > 0 ? "" : guessColour([j.product, j.material]);
        guess = said ? [said] : before.length > 0 ? before : named ? [named] : [];
      }
    }

    const fitsRaw = listFromSheet(ma.fits).map((l) => machineMatch(l, labels)).filter((x) => x.matched).map((x) => x.label);
    const tons = tonnagesIn(std?.machine);
    const remaining = j.qtyOrdered > 0 ? j.remaining : null;
    const runHours = remaining !== null && j.cycleSec > 0 && j.cavities > 0
      ? Math.round((remaining * j.cycleSec * 10) / (3600 * j.cavities)) / 10
      : null;
    const workers = Number(latinDigits(ma.workers ?? ""));
    const on = orderOn.get(codeKey(code)) ?? standsOn.get(nameKey(j.product));

    return {
      id: j.id, code, product: j.product, client,
      material: j.material, dueDate: j.dueDate, status: j.status, qtyKg: j.qtyOrderedKg,
      remaining, runHours,
      colours: answered.length > 0 ? answered : guess,
      colourSource: answered.length > 0 ? "answer" : guess.length > 0 ? "guess" : "",
      fits: ma.fits ? fitsRaw : null,
      fitsHint: tons.length ? registry.filter((m) => tons.includes(m.tonnage)).map((m) => m.label)
        .filter((l, i, arr) => arr.indexOf(l) === i) : [],
      fitsHintText: tons.join(" / "),
      workers: workers > 0 ? workers : null,
      oilCores: parseYesNo(ma.oilCores),
      missing: missingFromSheet(oa.missing),
      keyClient: parseYesNo(ca.keyClient) === true,
      mountedOn: on?.label ?? "",
      mountedRunning: !!on?.running,
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
    night: isNightHour(cairoHour()),
    canSetKeyClient: !!opts.role && hasFullAccess(opts.role),
    machines, orders,
    layout: validLayout(layout) ? layout : [],
    dataAgeMs: Math.max(0, Date.now() - readAt),
  };
}

/* --------------------------------- writing -------------------------------- */

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
    const standing = answersFor(mergeAnswers(answerRows(tab.records)), kind, keyFor(kind, row.name));
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
function colourCell(raw: unknown): string {
  const list = Array.isArray(raw) ? raw : [raw];
  const keys: string[] = [];
  for (const x of list.slice(0, 8)) {
    const k = colourKey(safeText(x, 40));
    if (k && !keys.includes(k)) keys.push(k);
  }
  return coloursToSheet(keys);
}

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
      name = (hit.code || "").trim();
    } else if (kind === "mold") {
      const k = nameKey(asked);
      const hit = masterTab.records.find((r) => nameKey(r.name) === k)?.name
        ?? jobsTab.records.find((r) => nameKey(r.product) === k)?.product;
      if (!k || !hit) return refuse("unknown_product");
      name = hit.replace(/\s+/g, " ").trim();
    } else {
      const k = fold(asked);
      const hit = masterTab.records.find((r) => fold(r.client) === k)?.client
        ?? jobsTab.records.find((r) => fold(r.client) === k)?.client;
      if (!k || !hit) return refuse("unknown_client");
      name = hit.replace(/\s+/g, " ").trim();
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
          cell = colourCell(raw);
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
          if (!Array.isArray(raw) || raw.length === 0) return refuse("bad_fits");
          const out: string[] = [];
          for (const l of raw) {
            const m = machineMatch(String(l), labels);
            if (!m.matched) return refuse("unknown_machine");
            if (!out.includes(m.label)) out.push(m.label);
          }
          cell = listToSheet(out);
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

  // «ترتيب الخريطة» was added after the tab already existed, and an append
  // silently DROPS a value whose header the tab does not have — so make sure
  // the header is there first (a no-op once it is; `no_tab` means the append
  // below creates the tab with every header).
  if (rows.some((r) => r.row.layout)) {
    const res = await ensureHeaders("changeoverAnswers", ANSWERS_HEADERS);
    if (!res.ok && res.reason !== "no_tab") {
      console.error(`[changeover] could not add the map column: ${res.reason}`);
      return refuse("save_failed", 503);
    }
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
  colours: string[];
  /** What the page showed as standing before — the log's "from" columns. */
  fromProducts: string[];
  fromColours: string[];
  minutes: number;
  reasons: string;
  /** true = "this is what is standing on the machine now" — the log row only. */
  baseline: boolean;
};

/** What happened to each of the three writes; the page says all three. */
export type WriteOutcome = "written" | "unchanged" | "skipped" | "failed";
export type MountResult =
  | { ok: true; replay: boolean; job: WriteOutcome; jobNote: string; registry: WriteOutcome; registryNote: string }
  | { ok: false; reason: string; status: number };

const cleanList = (list: unknown, max = 160): string[] =>
  (Array.isArray(list) ? list : []).slice(0, 6).map((x) => safeText(x, max).replace(/\s+/g, " ")).filter(Boolean);

/**
 * Record a mould going onto a machine — or what is standing on it now.
 *
 * ONE row in «تغييرات الاسطمبات» is the record; the order's machine cell and
 * the registry's product cell follow it, each reported on its own — a change
 * that IS in the log must never be reported as failed because a second cell
 * was refused. The bridge is at-least-once, so the log is read fresh first
 * and a row that already says exactly this is a replay, not a second change.
 */
export async function recordMount(input: MountInput, by: string): Promise<MountResult> {
  const fail = (reason: string, status = 400): MountResult => ({ ok: false, reason, status });
  if (!sheetsWritable()) return fail("not_writable", 503);

  const [machinesTab, jobsTab, masterTab, logTab] = await Promise.all([
    getRecords("machines"), getRecords("jobs"), getRecords("master"),
    getRecords("changeoverLog", { fresh: true }).catch(none),
  ]);
  const registry = registryFrom(machinesTab.records);
  const mm = machineMatch(input.machine, registry.map((m) => m.label));
  if (!mm.matched) return fail("unknown_machine");
  const mk = machineKey(mm.label);

  // The order, when one is named: it must exist — and its product is the
  // sheet's, never the request's.
  const want = codeKey(input.order);
  const jobRows = want ? jobsTab.records.filter((r) => codeKey(r.code) === want) : [];
  if (want && jobRows.length === 0) return fail("unknown_order");
  const job = jobRows[0];

  const products = job ? [(job.product || "").replace(/\s+/g, " ").trim()].filter(Boolean) : cleanList(input.products);
  if (products.length === 0) return fail("no_product");
  const productCell = listToSheet(products);
  const colourCells = coloursToSheet(cleanList(input.colours, 40).map(colourKey).filter(Boolean));
  const masterRow = masterTab.records.find((r) => nameKey(r.name) === nameKey(products[0]));

  const says = (row: { toProduct: string; order: string; toColour: string } | undefined) =>
    !!row && fold(row.toProduct) === fold(productCell) && codeKey(row.order) === want
    && fold(coloursToSheet(coloursFromSheet(row.toColour))) === fold(colourCells);

  const replay = says(standingFromLog(logRows(logTab.records)).get(mk));
  if (!replay) {
    const res = await appendLazy("changeoverLog", {
      date: cairoStamp(),
      machine: mm.label,
      fromProduct: listToSheet(cleanList(input.fromProducts)),
      fromColour: coloursToSheet(cleanList(input.fromColours, 40).map(colourKey).filter(Boolean)),
      order: job ? (job.code || "").trim() : "",
      toProduct: productCell,
      toColour: colourCells,
      material: masterRow?.material || "",
      minutes: input.baseline || !Number.isFinite(input.minutes) ? "" : String(Math.max(0, Math.round(input.minutes))),
      reasons: safeText(input.reasons, 300),
      by,
    });
    if (!res.ok) {
      // Same at-least-once check as the answers: the row may be there.
      const after = standingFromLog(logRows((await getRecords("changeoverLog", { fresh: true }).catch(none)).records)).get(mk);
      if (!says(after)) {
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
