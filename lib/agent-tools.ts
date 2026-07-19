/**
 * Server-side implementations of the AI agent's tools.
 *
 * These wrap EXISTING code (lib/sheets.ts, lib/oee-data.ts, lib/ai-review.ts) —
 * they never reinvent the data layer. The agent only ever READS or PROPOSES here;
 * the two write executors (appendProductionRows / updateCell / logIssue) are called
 * ONLY after the human confirms a preview in the UI, from the route's confirm branch.
 *
 * Everything is token-frugal: reads are sliced, OEE is returned as the compact
 * digest, and getRecords results are cached per request so a tool loop that reads
 * the same tab twice pays the Apps Script round-trip once.
 */

import {
  getRecords, appendRecord, updateRecord, ensureTab, ENTITIES,
  type SheetRecord, type UpdateResult,
} from "@/lib/sheets";
import { buildOEEData } from "@/lib/oee-data";
import { buildDigest, cairoDay } from "@/lib/ai-review";
import { latinDigits, normalizeDate } from "@/lib/dates";

/* ------------------------------ per-request cache ------------------------- */
// A cache lives for ONE HTTP request (one chat turn or one confirm), so the same
// tab is never fetched twice in a tool loop, but data is never stale across turns.
export type ToolCtx = { records: Map<string, Promise<{ records: SheetRecord[] }>> };
export const newToolCtx = (): ToolCtx => ({ records: new Map() });

function cachedRecords(entity: string, ctx: ToolCtx) {
  let p = ctx.records.get(entity);
  if (!p) { p = getRecords(entity); ctx.records.set(entity, p); }
  return p;
}

/* --------------------------------- helpers -------------------------------- */

const num = (v: unknown): number => {
  const x = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(x) ? x : 0;
};
/** Join key: Arabic digits → Latin, lowercase, collapsed spaces (mirrors lib/oee-data). */
const normKey = (s: string | undefined) =>
  latinDigits(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/* --------------------------------- READ ----------------------------------- */

const READABLE = new Set(["production", "master", "machines", "molds", "products", "clients", "jobs", "issues", "hourly"]);

/** read_records — sliced + de-noised view of any tab the agent may inspect. */
export async function readRecords(
  entity: string, search: string | undefined, limit: number | undefined, ctx: ToolCtx,
) {
  if (!READABLE.has(entity)) return { error: `unknown entity "${entity}". Use one of: ${[...READABLE].join(", ")}` };
  const { records } = await cachedRecords(entity, ctx);
  const cap = Math.min(Math.max(1, limit ?? 30), 60);

  let out = records;
  if (search && search.trim()) {
    const q = normKey(search);
    out = records.filter((r) =>
      Object.entries(r).some(([k, v]) => k !== "row" && normKey(String(v)).includes(q)),
    );
  }
  const total = out.length;
  return {
    entity,
    total,
    returned: Math.min(total, cap),
    truncated: total > cap,
    records: out.slice(0, cap),
  };
}

/** get_oee — the same compact digest the daily review reasons over (numbers only). */
export async function getOee(month: string | undefined) {
  const scope = month || "all";
  const data = await buildOEEData(month || null);
  return buildDigest(data, scope, cairoDay());
}

/* ------------------------------ VALIDATION -------------------------------- */
// Rules from CLAUDE.md, applied before ANY production row is shown for confirm:
//   • product exists in Master (join by name, else code)
//   • machine label exists in the registry (resolve by product name if codes clash)
//   • shots × openCavities − good ≥ 0   (scrap can never be negative)
//   • duplicate (date + shift + machine) detection
// Errors block the write; warnings are shown but the human may still confirm.

export type ProposedRow = {
  date?: string; shift?: string; machine?: string; machineCode?: string;
  mold?: string; product?: string; plannedMin?: number | string;
  good?: number | string; scrap?: number | string; shots?: number | string;
  openCavities?: number | string; downtimeMin?: number | string;
  downtimeReason?: string; operator?: string; note?: string;
};

/** A row normalized to the Production tab's field shape, plus check results. */
export type ValidatedRow = {
  values: {
    date: string; shift: string; machine: string; machineCode: string;
    mold: string; product: string; plannedMin: string;
    goodUnits: string; scrapUnits: string; openCavities: string;
    downtimeMin: string; downtimeReason: string; operator: string; note: string;
  };
  errors: string[];
  warnings: string[];
};

export async function validateProductionRows(rows: ProposedRow[], ctx: ToolCtx): Promise<ValidatedRow[]> {
  const [master, machines, production] = await Promise.all([
    cachedRecords("master", ctx),
    cachedRecords("machines", ctx),
    cachedRecords("production", ctx),
  ]);

  // Known product/mold names + codes from Master.
  const products = new Set<string>();
  for (const m of master.records) {
    if (m.name) products.add(normKey(m.name));
    if (m.code) products.add(normKey(m.code));
  }
  // Product → its Master machine (used to RESOLVE an unknown machine label).
  const machineByProduct = new Map<string, string>();
  for (const m of master.records) {
    const key = normKey(m.name);
    if (key && m.machine) machineByProduct.set(key, m.machine.trim());
  }

  // Valid machine identifiers: the code label "PQ n — ton", the bare code, the name.
  const machineLabels = new Set<string>();
  for (const m of machines.records) {
    const code = (m.code || "").trim();
    const name = latinDigits((m.name || "").trim());
    const label = code ? `${code} — ${name}` : name;
    for (const k of [label, code, name]) { const nk = normKey(k); if (nk) machineLabels.add(nk); }
  }

  // Existing (date+shift+machine) keys for duplicate detection.
  const existing = new Set<string>();
  for (const r of production.records) {
    const machine = (r.machineCode || "").trim() || latinDigits((r.machine || "").trim());
    existing.add(`${normalizeDate(r.date)}|${normKey(r.shift)}|${normKey(machine)}`);
  }

  return rows.map((r) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const date = normalizeDate(r.date);
    if (!date) errors.push(`Unreadable or missing date "${r.date ?? ""}".`);

    const productKey = normKey(r.product) || normKey(r.mold);
    if (!productKey) errors.push("No product or mold named.");
    else if (!products.has(productKey))
      warnings.push(`Product "${(r.product || r.mold || "").trim()}" is not in Master — check the exact name (joins are by name).`);

    // Machine — resolve via product if the given label is unknown.
    let machine = (r.machine || "").trim();
    if (machine && !machineLabels.has(normKey(machine))) {
      const resolved = machineByProduct.get(productKey);
      if (resolved) { warnings.push(`Machine "${machine}" not in registry — resolved to "${resolved}" via product.`); machine = resolved; }
      else warnings.push(`Machine "${machine}" is not in the machines registry.`);
    } else if (!machine) {
      const resolved = machineByProduct.get(productKey);
      if (resolved) { warnings.push(`No machine given — assumed "${resolved}" from the product's Master row.`); machine = resolved; }
      else warnings.push("No machine given.");
    }

    const good = num(r.good);
    const shots = num(r.shots);
    const open = num(r.openCavities);
    let scrap = r.scrap === undefined || r.scrap === "" ? NaN : num(r.scrap);

    // scrap = shots × openCavities − good  (derive it when the crew logged shots).
    if (Number.isNaN(scrap) && shots > 0 && open > 0) {
      scrap = shots * open - good;
      if (scrap < 0) errors.push(`Impossible: shots(${shots})×cavities(${open}) − good(${good}) = ${scrap} < 0.`);
    } else if (shots > 0 && open > 0) {
      const derived = shots * open - good;
      if (derived < 0) errors.push(`Impossible: shots(${shots})×cavities(${open}) − good(${good}) = ${derived} < 0.`);
      else if (Math.abs(derived - scrap) > Math.max(1, derived * 0.02))
        warnings.push(`Given scrap ${scrap} ≠ shots×cavities − good (${derived}).`);
    }
    if (Number.isNaN(scrap)) scrap = 0;
    if (good < 0) errors.push("Good units cannot be negative.");
    if (scrap < 0) errors.push("Scrap units cannot be negative.");

    const key = `${date}|${normKey(r.shift)}|${normKey(machine)}`;
    if (date && existing.has(key))
      warnings.push(`A production row already exists for ${date} · ${r.shift || "?"} · ${machine || "?"}.`);

    return {
      values: {
        date,
        shift: (r.shift || "").trim(),
        machine,
        machineCode: (r.machineCode || "").trim(),
        mold: (r.mold || "").trim(),
        product: (r.product || "").trim(),
        plannedMin: String(num(r.plannedMin) || 720),
        goodUnits: String(good),
        scrapUnits: String(scrap),
        openCavities: open > 0 ? String(open) : "",
        downtimeMin: String(num(r.downtimeMin)),
        downtimeReason: (r.downtimeReason || "").trim() || "None",
        operator: (r.operator || "").trim(),
        note: (r.note || "").trim(),
      },
      errors,
      warnings,
    };
  });
}

/* ---------------------------- issue validation ---------------------------- */

export type ProposedIssue = {
  date?: string; machine?: string; product?: string; category?: string;
  description?: string; action?: string; status?: string; note?: string;
};
export type ValidatedIssue = {
  values: Record<string, string>;
  errors: string[];
  warnings: string[];
};

export async function validateIssue(issue: ProposedIssue, ctx: ToolCtx): Promise<ValidatedIssue> {
  const machines = await cachedRecords("machines", ctx);
  const labels = new Set<string>();
  for (const m of machines.records) {
    const code = (m.code || "").trim();
    const name = latinDigits((m.name || "").trim());
    for (const k of [code ? `${code} — ${name}` : name, code, name]) { const nk = normKey(k); if (nk) labels.add(nk); }
  }
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!issue.description || !issue.description.trim()) errors.push("An issue needs a description.");
  const machine = (issue.machine || "").trim();
  if (machine && !labels.has(normKey(machine))) warnings.push(`Machine "${machine}" is not in the registry.`);
  // Floor reports get machine codes wrong more often than product names — when a
  // product is given, check it against Master so the human sees a mismatch early.
  const product = (issue.product || "").trim();
  if (product && !product.includes("غير متاح")) {
    const master = await cachedRecords("master", ctx);
    const names = new Set(master.records.map((r) => normKey(r.name || r.product)));
    if (!names.has(normKey(product))) warnings.push(`Product "${product}" is not in Master.`);
  }
  return {
    values: {
      date: normalizeDate(issue.date) || cairoDay(),
      machine,
      product,
      category: (issue.category || "").trim(),
      description: (issue.description || "").trim(),
      action: (issue.action || "").trim(),
      status: (issue.status || "").trim() || "مفتوح",
      note: (issue.note || "").trim(),
    },
    errors,
    warnings,
  };
}

/* --------------------------- cell-update validation ----------------------- */

export type ProposedUpdate = { entity: string; row: number; field: string; value: string };

const UPDATABLE = new Set(["master", "clients", "production", "jobs", "machines"]);

export function validateUpdate(u: ProposedUpdate): { ok: boolean; error?: string } {
  if (!UPDATABLE.has(u.entity)) return { ok: false, error: `entity "${u.entity}" is not editable here.` };
  const cfg = ENTITIES[u.entity];
  if (!cfg) return { ok: false, error: `unknown entity "${u.entity}".` };
  if (!cfg.fields.some((f) => f.key === u.field)) return { ok: false, error: `field "${u.field}" not found on ${u.entity}.` };
  if (!Number.isFinite(u.row) || u.row < 2) return { ok: false, error: `bad row ${u.row}.` };
  return { ok: true };
}

/* --------------------------------- WRITES --------------------------------- */
// Called ONLY from the route's confirm branch, after the human clicked Confirm.

export async function appendProductionRows(
  rows: ValidatedRow["values"][],
): Promise<{ ok: boolean; results: UpdateResult[] }> {
  const results: UpdateResult[] = [];
  for (const v of rows) results.push(await appendRecord("production", v));
  return { ok: results.every((r) => r.ok), results };
}

// Header row for «الأعطال», mirrors apps-script.gs ISSUES_HEADERS. Used to
// self-provision the tab the first time an issue is logged.
const ISSUES_HEADERS = [
  "التاريخ\nDate", "الماكينة\nMachine", "المنتج\nProduct", "التصنيف\nCategory",
  "الوصف\nDescription", "الإجراء\nAction", "الحالة\nStatus", "ملاحظات\nNotes",
];

export async function logIssue(values: Record<string, string>): Promise<UpdateResult> {
  const first = await appendRecord("issues", values);
  if (first.ok || first.reason !== "no_tab") return first;
  // The faults tab doesn't exist yet — try to create it, then append once more.
  // (Works only once the createTab action is deployed; otherwise stays no_tab.)
  const made = await ensureTab(ENTITIES.issues.tab, ISSUES_HEADERS);
  if (!made.ok) return { ok: false, reason: "issues_tab_missing" };
  return appendRecord("issues", values);
}

export async function updateCell(u: ProposedUpdate): Promise<UpdateResult> {
  const v = validateUpdate(u);
  if (!v.ok) return { ok: false, reason: v.error };
  return updateRecord(u.entity, u.row, { [u.field]: u.value });
}
