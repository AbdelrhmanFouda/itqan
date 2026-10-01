import {
  getRecords, appendRecord, ensureTab, updateRecord, expectSupported, sheetsWritable,
  type SheetRecord, type UpdateResult,
} from "@/lib/sheets";
import { loadJobs } from "@/lib/jobs";
import { nameKey } from "@/lib/master-lookup";
import { codeKey, machineMatch } from "@/lib/work-orders";
import { latinDigits, todayIso } from "@/lib/dates";
import { cairoStamp } from "@/lib/customer-requests";
import { hasFullAccess, type Role } from "@/lib/roles";
import {
  ANSWERS_HEADERS, ANSWERS_TAB, LOG_HEADERS, LOG_TAB, ANSWER_COLUMNS, ANY_COLOUR,
  answersFor, colourDef, colourKey, colourToSheet, fold, guessColour, isNightHour, kindFromSheet,
  kindToSheet, listFromSheet, listToSheet, machineKey, mergeAnswers, missingFromSheet, missingToSheet,
  parseYesNo, safeText, standingFromLog, yesNo, MISSING_ITEMS,
  type AnswerColumn, type AnswerKind, type AnswerRow, type MachineNow, type MachineState,
  type PlanMachine, type PlanOrder,
} from "@/lib/changeover";

/**
 * «خطة الاسطمبات» — the server glue between the workbook and the rules.
 *
 * The rules are in lib/changeover.ts, which imports nothing so Node's test
 * runner can load it and the page can rank in the browser. This file is the
 * half that touches the sheet: it shapes the machines and the open orders
 * once, joins the engineer's standing answers on, and does the three writes a
 * confirmed change makes. Same split as lib/stock-data.ts over lib/stock.ts.
 *
 * READS  «الماكينات», «أوامر العمل» (+ «الإنتاج» for what is left to make),
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
  /** 20:00–08:00 Cairo: no mould changes and no samples on the night shift. */
  night: boolean;
  /** Only the owner and a manager mark a client as important. */
  canSetKeyClient: boolean;
  machines: PlanMachine[];
  orders: PlanOrder[];
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

type Registry = { label: string; tonnage: string; code: string; row: number; product: string; active: boolean }[];

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
      active: fold(r.active) !== "inactive",
    });
  }
  return out;
}

function keyFor(kind: AnswerKind, name: string): string {
  switch (kind) {
    case "machine": return machineKey(name);
    case "mold": return nameKey(name);
    case "order": return codeKey(name);
    case "client": return fold(name);
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

export async function loadPlan(opts: { fresh?: boolean; role?: Role } = {}): Promise<ChangeoverResponse> {
  const fresh = { fresh: !!opts.fresh };
  const [jobsData, machinesTab, masterTab, answersTab, logTab] = await Promise.all([
    // The list needs what is LEFT to make, so «الإنتاج» is joined; downtime is not.
    loadJobs({ downtime: false }),
    getRecords("machines"),
    getRecords("master"),
    getRecords("changeoverAnswers", fresh).catch(none),
    getRecords("changeoverLog", fresh).catch(none),
  ]);

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
  const standing = standingFromLog(logTab.records.map((r) => ({
    machine: r.machine || "", order: r.order || "", toProduct: r.toProduct || "",
    toColour: r.toColour || "", material: r.material || "",
  })));

  const openJobs = jobsData.jobs.filter((j) => j.open);
  const jobByCode = new Map<string, (typeof openJobs)[number]>();
  for (const j of jobsData.jobs) { const k = codeKey(j.code); if (k && !jobByCode.has(k)) jobByCode.set(k, j); }

  /* ------------------------------- machines ------------------------------- */

  const machines: PlanMachine[] = [];
  const seen = new Set<string>();
  const mountedOn = new Map<string, string>(); // job-code key → machine label
  for (const m of registry) {
    const mk = machineKey(m.label);
    if (seen.has(mk)) continue; // the registry may list a machine once per product
    seen.add(mk);

    const st = standing.get(mk);
    let now: MachineNow;
    let state: MachineState = "unknown";
    if (st) {
      now = {
        product: st.toProduct.trim(),
        colour: colourKey(st.toColour),
        material: st.material.trim() || master.get(nameKey(st.toProduct))?.material || "",
        order: st.order.trim(),
        source: "plan",
      };
      const ok = codeKey(now.order);
      if (ok) {
        const job = jobByCode.get(ok);
        const finished = !job || !job.open || (job.qtyOrdered > 0 && job.remaining === 0);
        state = finished ? "free" : "running";
        if (!finished) mountedOn.set(ok, m.label);
      }
    } else if (m.product) {
      const material = master.get(nameKey(m.product))?.material || "";
      now = { product: m.product, colour: guessColour([m.product, material]), material, order: "", source: "registry" };
    } else {
      now = { product: "", colour: "", material: "", order: "", source: "none" };
    }

    const a = answersFor(answers, "machine", mk);
    machines.push({
      label: m.label, tonnage: m.tonnage, active: m.active, now, state,
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

    const answered = colourKey(oa.colour);
    const guess = answered
      ? ""
      : colourKey(j.masterbatch) === ANY_COLOUR
        ? ANY_COLOUR
        : guessColour([j.instructions, j.notes, j.masterbatch, j.product, j.material]);

    const fitsRaw = listFromSheet(ma.fits).map((l) => machineMatch(l, labels)).filter((x) => x.matched).map((x) => x.label);
    const tons = tonnagesIn(std?.machine);
    const remaining = j.qtyOrdered > 0 ? j.remaining : null;
    const runHours = remaining !== null && j.cycleSec > 0 && j.cavities > 0
      ? Math.round((remaining * j.cycleSec * 10) / (3600 * j.cavities)) / 10
      : null;
    const workers = Number(latinDigits(ma.workers ?? ""));

    return {
      id: j.id, code, product: j.product, client,
      material: j.material, dueDate: j.dueDate, status: j.status, qtyKg: j.qtyOrderedKg,
      remaining, runHours,
      colour: answered || guess,
      colourSource: answered ? "answer" : guess ? "guess" : "",
      fits: ma.fits ? fitsRaw : null,
      fitsHint: tons.length ? registry.filter((m) => tons.includes(m.tonnage)).map((m) => m.label)
        .filter((l, i, arr) => arr.indexOf(l) === i) : [],
      fitsHintText: tons.join(" / "),
      workers: workers > 0 ? workers : null,
      oilCores: parseYesNo(ma.oilCores),
      missing: missingFromSheet(oa.missing),
      keyClient: parseYesNo(ca.keyClient) === true,
      mountedOn: mountedOn.get(codeKey(code)) ?? "",
    };
  });

  // The page's own two tabs count too: an answer saved a minute ago and not
  // yet in the served copy is exactly what "numbers from X ago" is for.
  const readAt = Math.min(jobsData.readAt, machinesTab.readAt, masterTab.readAt, answersTab.readAt, logTab.readAt);
  return {
    ok: true,
    configured: jobsData.configured,
    writable: sheetsWritable(),
    today: todayIso(),
    night: isNightHour(cairoHour()),
    canSetKeyClient: !!opts.role && hasFullAccess(opts.role),
    machines, orders,
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

/**
 * Save what the engineer answered — one row per (kind, name).
 *
 * Every NAME is checked against the sheet it belongs to and written in that
 * sheet's own spelling, never the request's: a machine must be a registry
 * label, an order a job code, a mould a product an open order or Master
 * names, a client the client of some order. A column asked about the wrong
 * kind of thing is refused, and «عميل مهم» is the owner's and a manager's.
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
    if (!kind || !asked) return refuse("bad_item");

    let name = "";
    if (kind === "machine") {
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
          const text = safeText(raw, 40);
          const k = colourKey(text);
          if (!k) return refuse("bad_colour");
          cell = k === ANY_COLOUR || colourDef(k) ? colourToSheet(k) : text;
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
  product: string;
  colour: string;
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

/**
 * Record a mould going onto a machine.
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

  // The order, when one is named: it must exist once and still be open.
  const want = codeKey(input.order);
  const jobRows = want ? jobsTab.records.filter((r) => codeKey(r.code) === want) : [];
  if (want && jobRows.length === 0) return fail("unknown_order");
  const job = jobRows[0];

  const product = (job ? job.product || "" : safeText(input.product, 160)).replace(/\s+/g, " ").trim();
  if (!product) return fail("no_product");
  const colourK = colourKey(safeText(input.colour, 40));
  const colourCell = !colourK ? "" : colourK === ANY_COLOUR || colourDef(colourK) ? colourToSheet(colourK) : safeText(input.colour, 40);
  const masterRow = masterTab.records.find((r) => nameKey(r.name) === nameKey(product));

  const standing = standingFromLog(logTab.records.map((r) => ({
    machine: r.machine || "", order: r.order || "", toProduct: r.toProduct || "",
    toColour: r.toColour || "", material: r.material || "",
  }))).get(mk);

  const replay = !!standing
    && nameKey(standing.toProduct) === nameKey(product)
    && codeKey(standing.order) === want
    && colourKey(standing.toColour) === colourK;

  if (!replay) {
    const res = await appendLazy("changeoverLog", {
      date: cairoStamp(),
      machine: mm.label,
      fromProduct: standing?.toProduct ?? "",
      fromColour: standing?.toColour ?? "",
      order: job ? (job.code || "").trim() : "",
      toProduct: product,
      toColour: colourCell,
      material: masterRow?.material || "",
      minutes: input.baseline || !Number.isFinite(input.minutes) ? "" : String(Math.max(0, Math.round(input.minutes))),
      reasons: safeText(input.reasons, 300),
      by,
    });
    if (!res.ok) {
      // Same at-least-once check as the answers: the row may be there.
      const after = standingFromLog((await getRecords("changeoverLog", { fresh: true }).catch(none)).records.map((r) => ({
        machine: r.machine || "", order: r.order || "", toProduct: r.toProduct || "",
        toColour: r.toColour || "", material: r.material || "",
      }))).get(mk);
      const landed = !!after && nameKey(after.toProduct) === nameKey(product)
        && codeKey(after.order) === want && colourKey(after.toColour) === colourK;
      if (!landed) {
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
