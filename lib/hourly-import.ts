import { getRecords, updateRecordsInTab, type SheetRecord } from "@/lib/sheets";
import { normalizeDate, latinDigits } from "@/lib/dates";
import { HOUR_KEYS } from "@/lib/hourly";
import {
  buildRowChanges, findFreeRows, matchSheetRow, sumCavities, validateRowChanges,
  BAND_FIRST_ROW, BAND_LAST_ROW, HOURS_PER_SHIFT,
  type Shift, type SheetRow,
} from "@/lib/sheet-import";

/**
 * Fetch-and-shape half of the paper-sheet import — the same split as
 * `oee.ts`/`oee-data.ts` and `downtime.ts`/`downtime-data.ts`. All the maths and
 * every rule that can be got wrong silently lives in the pure, unit-tested
 * `lib/sheet-import.ts`; this file only reads the sheet, resolves names against
 * it, and writes.
 *
 * TWO PHASES, and they do NOT trust each other:
 *
 *   buildDraft()  reads the photo's rows, resolves them against the sheet as it
 *                 is now, and returns a preview for the owner to correct.
 *   commitDraft() throws that preview's conclusions away and re-derives every
 *                 one of them from a FRESH read before writing a single cell.
 *
 * That asymmetry is the point. The assistant's existing confirm flow is
 * accept/reject with no server-side re-check, which is safe there because it
 * re-states a payload the server itself built moments earlier. Here the browser
 * has spent minutes with an editable grid open, the crew edits this workbook
 * daily, and a stale row number would write a night's output onto somebody
 * else's product. So the row numbers the browser sends are treated as a claim
 * to be verified, never as an instruction.
 */

const norm = (s: string | undefined) =>
  latinDigits(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/** Fields that make a sheet row "occupied" — deliberately NOT the formula
 *  columns. AB سستم is `=SUM(...)` pre-filled to row 998 and renders 0 on every
 *  blank row; counting that as content would report the band full at row 5. */
const OCCUPANCY_KEYS = ["date", "machine", "product", ...HOUR_KEYS] as const;

const isOccupied = (r: SheetRecord) =>
  OCCUPANCY_KEYS.some((k) => (r[k] ?? "").trim() !== "");

/* ------------------------------ the draft --------------------------------- */

export type DraftRow = {
  id: string;
  /** exactly as the model read it off the paper */
  machinePaper: string;
  productPaper: string;
  hoursPaper: (number | null)[];
  actualPaper: number | null;
  note: string | null;
  /** resolved against the sheet — what would actually be written */
  machine: string;
  product: string;
  machineResolved: boolean;
  productResolved: boolean;
  /** the shots→pieces multiplier, from Master. 0 = could not resolve. */
  cavities: number;
  /** the row this line belongs to, or null → it needs a blank row */
  targetRow: number | null;
};

export type ImportDraft =
  | {
      ok: true;
      date: string;            // normalized ISO
      datePaper: string | null;
      dateForNewRow: string;   // verbatim string a NEW row would carry
      shift: Shift | null;     // null ⇒ the heading did not say; the UI must ask
      shiftHeading: string;
      shiftLabelForNewRow: string;
      rows: DraftRow[];
      machineOptions: string[];
      productOptions: string[];
      freeRows: number;
      model: string;
    }
  | { ok: false; reason: string; detail?: string };

type Resolved = {
  machineLabels: string[];
  machineByKey: Map<string, string>;
  productNames: string[];
  productByKey: Map<string, string>;
  cavitiesByKey: Map<string, number>;
  duplicateProducts: Set<string>;
  sheetRows: SheetRow[];
  occupied: Set<number>;
  rawDateFor: Map<string, string>;
  shiftLabels: { morning: string; evening: string };
};

/**
 * One read of the three tabs the import touches, shaped into lookups.
 * Re-run on commit rather than cached: the whole point of the second pass is
 * that the sheet may have changed while the preview sat open.
 */
async function readContext(): Promise<Resolved> {
  const [hourly, master, machines] = await Promise.all([
    getRecords("hourly"),
    getRecords("master"),
    getRecords("machines"),
  ]);

  // Machines: the identity everywhere is «PQ n — ton» (hidden col J), built the
  // same way lib/run-join.ts builds it. Tonnage alone is ambiguous (PQ 5 and
  // PQ 7 are both 100t), so the bare code is indexed but the tonnage is not.
  const machineLabels: string[] = [];
  const machineByKey = new Map<string, string>();
  for (const m of machines.records) {
    const code = (m.code || "").trim();
    const name = latinDigits((m.name || "").trim());
    const label = code ? `${code} — ${name}` : name;
    if (!label) continue;
    machineLabels.push(label);
    for (const k of [label, code]) {
      const nk = norm(k);
      if (nk && !machineByKey.has(nk)) machineByKey.set(nk, label);
    }
  }

  // Products: Master column C is the join key for the entire system. The stored
  // spelling is kept VERBATIM — «زراير» carries a trailing tab and «قاعدة » a
  // trailing space, and the sheet's own dropdown validation sources those exact
  // strings. Matching normalizes both sides; writing uses the sheet's spelling.
  const productNames: string[] = [];
  const productByKey = new Map<string, string>();
  const cavitiesByKey = new Map<string, number>();
  const seen = new Set<string>();
  const duplicateProducts = new Set<string>();
  for (const m of master.records) {
    const raw = m.name ?? "";
    const nk = norm(raw);
    // 30 Master rows are literally «غير متاح / N/A» — the deliberate filler, not
    // a product. They must never be offered as something to write.
    if (!nk || nk.includes("غير متاح") || nk === "n/a") continue;
    if (seen.has(nk)) { duplicateProducts.add(nk); continue; }
    seen.add(nk);
    productNames.push(raw);
    productByKey.set(nk, raw);
    const cav = sumCavities(m.cavities);
    if (cav > 0) cavitiesByKey.set(nk, cav);
  }

  // The hourly tab: what exists, what is free, and how this workbook spells
  // things it already contains.
  const sheetRows: SheetRow[] = [];
  const occupied = new Set<number>();
  const rawDateFor = new Map<string, string>();
  const shiftLabels = { morning: "", evening: "" };
  for (const r of hourly.records) {
    if (isOccupied(r)) occupied.add(r.row);
    const iso = normalizeDate(r.date);
    if (iso) {
      if (!rawDateFor.has(iso)) rawDateFor.set(iso, (r.date ?? "").trim());
      if ((r.machine ?? "").trim()) {
        sheetRows.push({ row: r.row, date: iso, machine: r.machine ?? "", product: r.product ?? "" });
      }
    }
    // ⚠ «تسجيل الإنتاج» has NO «الوردية» column — verified against the live tab
    // on 2026-08-10. Its real header row 4 is
    //   A التاريخ | B الماكينة/كود | C المنتج/الاسطمبة | D..AA the 24 hours | …
    // so both shifts share ONE row and the shift is implied purely by WHICH half
    // of the hour columns carries numbers. `ENTITIES.hourly` still declares a
    // `shift` field; `colIndex` finds no header for it, so the field is dropped
    // and `r.shift` is always empty. That is why this stays empty, why
    // buildRowChanges never emits a `shift` key, and why nothing is written to a
    // column that does not exist. Kept rather than deleted so that IF the column
    // is ever added, the import fills it with the sheet's own wording instead of
    // inventing one.
    const sh = (r.shift ?? "").trim();
    if (sh) {
      if (!shiftLabels.evening && /مسائ|مساء|ليل/.test(sh)) shiftLabels.evening = sh;
      if (!shiftLabels.morning && /صباح|نهار/.test(sh)) shiftLabels.morning = sh;
    }
  }

  return {
    machineLabels, machineByKey, productNames, productByKey, cavitiesByKey,
    duplicateProducts, sheetRows, occupied, rawDateFor, shiftLabels,
  };
}

/**
 * The date string a NEW row should carry.
 *
 * This workbook holds TWO date conventions in the same column, so inventing a
 * third would be a real cost — `normalizeDate()` already had to be taught both.
 * If the sheet already has any row for this day, its exact spelling is reused;
 * otherwise the zero-padded day-first form, which is the convention
 * `normalizeDate()` reads unambiguously.
 */
function dateForNewRow(iso: string, rawDateFor: Map<string, string>): string {
  const existing = rawDateFor.get(iso);
  if (existing) return existing;
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

export async function buildDraft(vision: {
  date: string | null; shift: Shift | null; shiftHeading: string; model: string;
  rows: { machine: string; product: string; hours: (number | null)[]; actualTotal: number | null; note: string | null }[];
}): Promise<ImportDraft> {
  const iso = normalizeDate(vision.date ?? "");
  if (!iso) return { ok: false, reason: "no_date", detail: vision.date ?? "" };

  const ctx = await readContext();

  const rows: DraftRow[] = vision.rows.map((r, i) => {
    const mk = norm(r.machine);
    const machine = ctx.machineByKey.get(mk) ?? r.machine;
    const machineResolved = ctx.machineByKey.has(mk);

    const pk = norm(r.product);
    const product = ctx.productByKey.get(pk) ?? r.product;
    // A product that exists TWICE in Master (سماعة اريون, rows 289 and 453)
    // cannot be resolved to one cavity count, so it is reported unresolved.
    const productResolved = ctx.productByKey.has(pk) && !ctx.duplicateProducts.has(pk);

    return {
      id: `r${i}`,
      machinePaper: r.machine,
      productPaper: r.product,
      hoursPaper: r.hours,
      actualPaper: r.actualTotal,
      note: r.note,
      machine,
      product,
      machineResolved,
      productResolved,
      cavities: productResolved ? ctx.cavitiesByKey.get(pk) ?? 0 : 0,
      targetRow: matchSheetRow(ctx.sheetRows, iso, { machine, product }),
    };
  });

  const needed = rows.filter((r) => r.targetRow === null).length;
  const { rows: freeRows } = findFreeRows(ctx.occupied, needed || 1);

  return {
    ok: true,
    date: iso,
    datePaper: vision.date,
    dateForNewRow: dateForNewRow(iso, ctx.rawDateFor),
    shift: vision.shift,
    shiftHeading: vision.shiftHeading,
    shiftLabelForNewRow: vision.shift ? ctx.shiftLabels[vision.shift] : "",
    rows,
    machineOptions: ctx.machineLabels,
    productOptions: ctx.productNames,
    freeRows: freeRows.length,
    model: vision.model,
  };
}

/* ------------------------------- the commit -------------------------------- */

export type CommitRow = {
  /** the row the preview believed this belongs to — a CLAIM, re-checked below */
  targetRow: number | null;
  machine: string;
  product: string;
  /** the twelve FINAL values the owner saw and approved, already multiplied */
  hours: (number | null)[];
  actualTotal: number | null;
};

export type CommitPayload = {
  date: string;   // ISO
  shift: Shift;
  rows: CommitRow[];
};

export type RowOutcome = {
  index: number;
  machine: string;
  product: string;
  row: number | null;
  action: "update" | "create";
  ok: boolean;
  reason?: string;
};

export type CommitResult =
  | { ok: true; written: number; cells: number; outcomes: RowOutcome[] }
  | { ok: false; reason: string; outcomes?: RowOutcome[] };

/** A cell value the sheet will accept: a whole, non-negative, believable count. */
function sane(n: number | null | undefined): number | null {
  if (n === null || n === undefined) return null;
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return NaN; // NaN ⇒ reject
  return Math.round(n);
}

/**
 * Write a confirmed draft.
 *
 * NOTHING from the preview is taken on trust: the sheet is read again, every
 * row is re-matched, every free row is re-checked as genuinely blank, and every
 * change set goes through the pure allow-list before the single batched POST.
 * Any row that fails aborts the WHOLE import — a partial write into a shared
 * log is harder to find and undo than no write at all.
 */
export async function commitDraft(payload: CommitPayload, actor: string): Promise<CommitResult> {
  if (payload.shift !== "morning" && payload.shift !== "evening") {
    return { ok: false, reason: "bad_shift" };
  }
  const iso = normalizeDate(payload.date);
  if (!iso) return { ok: false, reason: "bad_date" };
  if (!Array.isArray(payload.rows) || payload.rows.length === 0) {
    return { ok: false, reason: "no_rows" };
  }

  const ctx = await readContext();
  const outcomes: RowOutcome[] = [];
  const edits: { row: number; changes: Record<string, string> }[] = [];
  const claimed = new Set<number>();

  // Free rows are allocated from the FRESH occupancy read, extended as they are
  // taken so two new products cannot be handed the same blank row.
  const occupiedNow = new Set(ctx.occupied);

  for (let i = 0; i < payload.rows.length; i++) {
    const r = payload.rows[i];
    const fail = (reason: string, row: number | null, action: "update" | "create") => {
      outcomes.push({ index: i, machine: r.machine, product: r.product, row, action, ok: false, reason });
    };

    // 1. Identity must resolve against the sheet as it is NOW. A hand-typed
    //    machine or product name is exactly what CLAUDE.md warns never to match.
    const mk = norm(r.machine);
    const machine = ctx.machineByKey.get(mk);
    if (!machine) { fail("machine_unknown", null, "update"); continue; }

    const pk = norm(r.product);
    if (ctx.duplicateProducts.has(pk)) { fail("product_duplicated_in_master", null, "update"); continue; }
    const product = ctx.productByKey.get(pk);
    if (!product) { fail("product_unknown", null, "update"); continue; }

    // 2. Hours: exactly twelve, each a believable whole count or blank.
    if (!Array.isArray(r.hours) || r.hours.length !== HOURS_PER_SHIFT) {
      fail("bad_hours_length", null, "update"); continue;
    }
    const hours = r.hours.map(sane);
    if (hours.some((h) => h !== null && Number.isNaN(h))) { fail("bad_hour_value", null, "update"); continue; }
    const actualTotal = sane(r.actualTotal);
    if (actualTotal !== null && Number.isNaN(actualTotal)) { fail("bad_actual_value", null, "update"); continue; }
    if (hours.every((h) => h === null) && actualTotal === null) { fail("nothing_to_write", null, "update"); continue; }

    // 3. Re-match against the sheet. The preview's row number is a claim; if it
    //    disagrees with what the sheet says right now, somebody edited the tab
    //    while the preview was open and this import is out of date.
    const fresh = matchSheetRow(ctx.sheetRows, iso, { machine, product });
    const action: "update" | "create" = fresh === null ? "create" : "update";
    if (r.targetRow !== null && r.targetRow !== fresh) { fail("row_moved_since_preview", fresh, action); continue; }
    if (r.targetRow === null && fresh !== null) { fail("row_appeared_since_preview", fresh, action); continue; }

    let row: number;
    if (fresh !== null) {
      row = fresh;
    } else {
      const { rows: freeRows, bandExhausted } = findFreeRows(occupiedNow, 1);
      if (bandExhausted || freeRows.length === 0) { fail("band_full", null, "create"); continue; }
      row = freeRows[0];
      occupiedNow.add(row);
    }

    // 4. The row must be inside the pre-filled band. Outside it there are no
    //    AB/AD/AE formulas, no validation and no spill, and the row is broken
    //    for good — which is precisely what the bridge's `append` would do.
    if (row < BAND_FIRST_ROW || row > BAND_LAST_ROW) { fail("outside_band", row, action); continue; }
    if (claimed.has(row)) { fail("duplicate_target_row", row, action); continue; }
    claimed.add(row);

    // 5. Build and re-validate the change set against the pure allow-list.
    const changes = buildRowChanges(
      payload.shift,
      { machine, product, hours, actualTotal },
      action,
      {
        date: dateForNewRow(iso, ctx.rawDateFor),
        shift: ctx.shiftLabels[payload.shift],
        machine,
        product,
      },
    );
    const check = validateRowChanges(changes, payload.shift, action);
    if (!check.ok) { fail(`forbidden_columns:${check.bad.join(",")}`, row, action); continue; }
    if (Object.keys(changes).length === 0) { fail("nothing_to_write", row, action); continue; }

    edits.push({ row, changes });
    outcomes.push({ index: i, machine, product, row, action, ok: true });
  }

  const failed = outcomes.filter((o) => !o.ok);
  if (failed.length > 0) return { ok: false, reason: "validation_failed", outcomes };
  if (edits.length === 0) return { ok: false, reason: "nothing_to_write", outcomes };

  const res = await updateRecordsInTab("hourly", edits);
  if (!res.ok) return { ok: false, reason: res.reason || "write_failed", outcomes };

  // «تسجيل الإنتاج» has no notes column, so there is nowhere in the sheet to
  // stamp provenance without corrupting a cell nobody asked to change. Same
  // choice the assistant makes for single-cell updates: attribute in the log.
  console.log(
    `[hourly-import] ${actor} wrote ${edits.length} row(s) (${res.cells} cells) ` +
      `for ${iso} ${payload.shift}: ${edits.map((e) => e.row).join(", ")}`,
  );

  return { ok: true, written: edits.length, cells: res.cells ?? 0, outcomes };
}
