/**
 * Google Sheets integration — generic, config-driven.
 *
 * Two ways to reach the sheet:
 *   • Apps Script web app (preferred) — reads AND writes, works on a PRIVATE
 *     sheet, no service-account key (org policy blocks those). Runs as you.
 *   • API key (fallback, read-only) — needs the sheet shared "Anyone with link".
 *
 * Env (server-side only):
 *   GOOGLE_SHEETS_ID, GOOGLE_SHEETS_API_KEY            (API-key read fallback)
 *   GOOGLE_APPS_SCRIPT_URL, GOOGLE_APPS_SCRIPT_SECRET  (Apps Script read+write)
 */

const BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const SHEET_ID = process.env.GOOGLE_SHEETS_ID;
const API_KEY = process.env.GOOGLE_SHEETS_API_KEY;
const SCRIPT_URL = process.env.GOOGLE_APPS_SCRIPT_URL;
const SCRIPT_SECRET = process.env.GOOGLE_APPS_SCRIPT_SECRET;

export function sheetsConfigured(): boolean {
  return Boolean((SCRIPT_URL && SCRIPT_SECRET) || (SHEET_ID && API_KEY));
}
export function sheetsWritable(): boolean {
  return Boolean(SCRIPT_URL && SCRIPT_SECRET);
}

/* --------------------------- entity configs --------------------------- */

type FieldDef = { key: string; keywords: string[]; long?: boolean };
export type EntityConfig = { tab: string; titleEn: string; titleAr: string; fields: FieldDef[] };

export const ENTITIES: Record<string, EntityConfig> = {
  molds: {
    tab: "Molds", titleEn: "Molds Register", titleAr: "حصر الاسطمبات",
    fields: [
      { key: "code", keywords: ["mold code", "code", "كود"] },
      { key: "name", keywords: ["product / mold", "product", "mold name", "name", "المنتج", "اسم الاسطمبة"] },
      { key: "client", keywords: ["client", "العميل"] },
      { key: "cycle", keywords: ["cycle", "الدورة"] },
      { key: "operator", keywords: ["worker", "operator", "العامل"] },
      { key: "active", keywords: ["active", "نشط", "status"] },
    ],
  },
  products: {
    tab: "Products", titleEn: "Products", titleAr: "المنتجات",
    fields: [
      { key: "name", keywords: ["product", "المنتج"] },
      { key: "client", keywords: ["client", "العميل"] },
      { key: "weight", keywords: ["weight", "الوزن"] },
      { key: "material", keywords: ["material", "الخام"] },
      { key: "cavities", keywords: ["cav", "كافيتي"] },
      { key: "cycle", keywords: ["cycle", "الدورة"] },
      { key: "machine", keywords: ["machine", "الماكينة"] },
      { key: "defects", keywords: ["defect", "العيوب"], long: true },
      { key: "date", keywords: ["date", "التاريخ"] },
    ],
  },
  clients: {
    tab: "Clients", titleEn: "Clients", titleAr: "العملاء",
    fields: [
      { key: "name", keywords: ["client", "العميل"] },
      { key: "products", keywords: ["products", "عدد المنتجات"] },
      { key: "lastOrder", keywords: ["last order", "آخر طلب"] },
      { key: "contact", keywords: ["contact", "الشخص المسؤول", "المسؤول"] },
      { key: "phone", keywords: ["phone", "الهاتف"] },
      { key: "email", keywords: ["email", "البريد"] },
      { key: "address", keywords: ["address", "العنوان"] },
      { key: "type", keywords: ["type", "نوع العميل"] },
      { key: "status", keywords: ["status", "الحالة"] },
      { key: "payment", keywords: ["payment", "الدفع"] },
      { key: "notes", keywords: ["notes", "ملاحظات"], long: true },
    ],
  },
  // Daily production runs — the analytics foundation. One row per machine/shift.
  // Field order matters for append alignment: downtimeReason is declared before
  // downtimeMin and carries a distinctive keyword so the two never collide.
  production: {
    tab: "Production", titleEn: "Production Runs", titleAr: "تشغيلات الإنتاج",
    fields: [
      { key: "date", keywords: ["date", "التاريخ"] },
      { key: "shift", keywords: ["shift", "الوردية"] },
      { key: "machine", keywords: ["machine", "الماكينة"] },
      { key: "mold", keywords: ["mold", "الاسطمبة", "القالب"] },
      // Supervisors identify the part by PRODUCT NAME more often than by mold
      // code — read it so OEE can join Master standards by name too.
      { key: "product", keywords: ["أسم المنتج", "اسم المنتج", "prod name", "product"] },
      { key: "client", keywords: ["العميل", "client"] },
      { key: "material", keywords: ["نوع الخام", "الخام", "material"] },
      { key: "plannedMin", keywords: ["planned", "الزمن المخطط", "المخطط"] },
      { key: "goodUnits", keywords: ["good", "سليم"] },
      { key: "scrapUnits", keywords: ["scrap", "هالك"] },
      { key: "downtimeReason", keywords: ["downtime reason", "سبب التوقف", "reason", "سبب"] },
      { key: "downtimeMin", keywords: ["downtime", "زمن التوقف", "توقف"] },
      { key: "operator", keywords: ["operator", "worker", "العامل", "المشغل"] },
      { key: "note", keywords: ["note", "ملاحظ"], long: true },
    ],
  },
  // The machines tab is a DAILY PLAN: one row per machine per date with that
  // day's shift and planned shift length (minutes) + Active/Inactive status.
  // NOTE: shiftLength is declared BEFORE shift so appends can't drop the shift
  // name into the length column ("الوردية" is a substring of "طول الوردية").
  machines: {
    tab: "machines", titleEn: "Machines", titleAr: "الماكينات",
    fields: [
      { key: "code", keywords: ["كود الماكينة", "machine code"] },
      { key: "name", keywords: ["الماكينة", "machine"] },
      { key: "date", keywords: ["التاريخ", "date"] },
      { key: "product", keywords: ["أسم المنتج", "اسم المنتج", "prod name", "product"] },
      { key: "shiftLength", keywords: ["طول الوردية", "shift length", "دقيقة"] },
      { key: "shift", keywords: ["الوردية", "shift"] },
      { key: "active", keywords: ["الحالة", "status", "نشط", "active"] },
    ],
  },
  // Client work orders. One row per job; progress is COMPUTED from production
  // rows matched by product name + start date (no run⇄job foreign keys).
  jobs: {
    tab: "jobs", titleEn: "Jobs", titleAr: "أوامر العمل",
    fields: [
      // moldCode BEFORE code: "كود" alone would otherwise claim the mold-code
      // column during appends.
      { key: "moldCode", keywords: ["كود الاسطمبة", "mold code"] },
      { key: "code", keywords: ["كود الأمر", "job code"] },
      { key: "client", keywords: ["العميل", "client"] },
      { key: "product", keywords: ["المنتج", "product"] },
      { key: "qty", keywords: ["الكمية", "qty", "quantity"] },
      { key: "startDate", keywords: ["تاريخ البدء", "البدء", "start"] },
      { key: "dueDate", keywords: ["تاريخ التسليم", "التسليم", "due"] },
      { key: "machine", keywords: ["الماكينة", "machine"] },
      { key: "materialIssued", keywords: ["الخامة المصروفة", "المصروفة", "material issued"] },
      { key: "masterbatch", keywords: ["ماستر", "masterbatch"] },
      { key: "status", keywords: ["الحالة", "status"] },
      { key: "priority", keywords: ["الأولوية", "priority"] },
      { key: "instructions", keywords: ["التعليمات", "instruction"], long: true },
      { key: "notes", keywords: ["ملاحظ", "note"], long: true },
    ],
  },
  // The single source of truth. Read directly when we need the per-mold standards
  // (cycle time + cavities) that OEE's Performance factor depends on.
  master: {
    tab: "Master", titleEn: "Master", titleAr: "الرئيسي",
    fields: [
      { key: "id", keywords: ["id", "الرقم", "رقم"] },
      { key: "name", keywords: ["product / mold", "المنتج / الاسطمبة", "product", "mold name", "المنتج"] },
      { key: "code", keywords: ["mold code", "كود الاسطمبة", "code", "كود"] },
      { key: "cavities", keywords: ["cavities", "عدد الكافيتي", "cav", "كافيتي"] },
      { key: "cycle", keywords: ["cycle", "زمن الدورة", "الدورة"] },
      { key: "weight", keywords: ["الوزن", "weight"] },
      { key: "material", keywords: ["نوع الخام", "material"] },
      { key: "defects", keywords: ["العيوب", "defect"], long: true },
      { key: "machine", keywords: ["machine", "الماكينة"] },
      { key: "active", keywords: ["active", "نشط"] },
    ],
  },
};

/* ------------------------------ reading ------------------------------ */

async function resolveTabTitle(want: string): Promise<string> {
  if (!SHEET_ID || !API_KEY) return want;
  try {
    const res = await fetch(`${BASE}/${SHEET_ID}?key=${API_KEY}&fields=sheets.properties.title`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return want;
    const json = (await res.json()) as { sheets?: { properties?: { title?: string } }[] };
    const titles = (json.sheets ?? []).map((s) => s.properties?.title ?? "").filter(Boolean);
    const lc = want.trim().toLowerCase();
    return (
      titles.find((t) => t.toLowerCase() === lc) ||
      titles.find((t) => t.toLowerCase().includes(lc)) ||
      (titles.length === 1 ? titles[0] : want)
    );
  } catch {
    return want;
  }
}

async function fetchSheet(tab: string): Promise<{ title: string; values: string[][] }> {
  // Preferred: Apps Script (works on a private sheet, no API key).
  // getSheetByName() in the script is CASE-SENSITIVE and the sheet's tab names
  // have drifted between "Production"/"production" etc., so retry casings.
  if (SCRIPT_URL && SCRIPT_SECRET) {
    const lower = tab.toLowerCase();
    const cap = lower.charAt(0).toUpperCase() + lower.slice(1);
    const candidates = Array.from(new Set([tab, lower, cap, tab.toUpperCase()]));
    for (const name of candidates) {
      try {
        const u = `${SCRIPT_URL}?token=${encodeURIComponent(SCRIPT_SECRET)}&tab=${encodeURIComponent(name)}`;
        const res = await fetch(u, { cache: "no-store", redirect: "follow" });
        if (res.ok) {
          const json = (await res.json()) as { values?: string[][] };
          if (json.values && json.values.length > 0) return { title: name, values: json.values };
        }
      } catch {
        /* try the next casing, then fall through to the API-key path */
      }
    }
  }
  // Fallback: public read via API key.
  if (!SHEET_ID || !API_KEY) return { title: tab, values: [] };
  const title = await resolveTabTitle(tab);
  const range = `'${title.replace(/'/g, "''")}'`;
  const url = `${BASE}/${SHEET_ID}/values/${encodeURIComponent(range)}?key=${API_KEY}&majorDimension=ROWS`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { title, values: [] };
    const json = (await res.json()) as { values?: string[][] };
    return { title, values: json.values ?? [] };
  } catch {
    return { title, values: [] };
  }
}

const NA = new Set(["", "n/a", "na", "غير متاح", "غير متاح / n/a", "n/a / غير متاح", "-", "—", "–"]);
function clean(v: string | undefined): string {
  const s = (v ?? "").replace(/\s+/g, " ").trim();
  return NA.has(s.toLowerCase()) ? "" : s;
}

function colIndex(headers: string[], keywords: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = (headers[i] || "").toLowerCase();
    if (keywords.some((k) => h.includes(k))) return i;
  }
  return -1;
}

function findHeaderRow(values: string[][], fields: FieldDef[]): number {
  let best = values.length > 1 ? 1 : 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(values.length, 8); i++) {
    const row = values[i].map((c) => (c || "").toLowerCase());
    let score = 0;
    for (const f of fields) if (row.some((h) => f.keywords.some((k) => h.includes(k)))) score++;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

// "العميل\nClient" → { ar: "العميل", en: "Client" }
function splitLabel(h: string): { en: string; ar: string } {
  const s = (h || "").trim();
  const parts = s.split(/\n+/).map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 2) return { ar: parts[0], en: parts[1] };
  return { en: s, ar: s };
}

export type SheetRecord = { row: number } & Record<string, string>;
export type RecordsResult = {
  records: SheetRecord[];
  fields: string[];
  longFields: string[];
  labels: Record<string, { en: string; ar: string }>;
  writable: boolean;
};

export async function getRecords(entity: string): Promise<RecordsResult> {
  const cfg = ENTITIES[entity];
  const empty: RecordsResult = { records: [], fields: [], longFields: [], labels: {}, writable: sheetsWritable() };
  if (!cfg) return empty;

  const { values } = await fetchSheet(cfg.tab);
  if (values.length < 2) return empty;

  const h = findHeaderRow(values, cfg.fields);
  const headers = values[h] ?? [];
  const idx: Record<string, number> = {};
  for (const f of cfg.fields) idx[f.key] = colIndex(headers, f.keywords);

  const present = cfg.fields.filter((f) => idx[f.key] >= 0);
  const fields = present.map((f) => f.key);
  const longFields = present.filter((f) => f.long).map((f) => f.key);
  const labels: Record<string, { en: string; ar: string }> = {};
  for (const f of present) labels[f.key] = splitLabel(headers[idx[f.key]]);

  const records: SheetRecord[] = [];
  for (let r = h + 1; r < values.length; r++) {
    const row = values[r];
    if (!row || row.length === 0) continue;
    const rec = { row: r + 1 } as unknown as SheetRecord;
    let any = false;
    for (const f of present) {
      const v = clean(row[idx[f.key]]);
      rec[f.key] = v;
      if (v) any = true;
    }
    if (!any) continue;
    // Skip spreadsheet summary/total rows (e.g. "الإجمالي / Total").
    const head = rec[present[0].key] || "";
    if (/الإجمالي|إجمالي|الاجمالي|اجمالي/.test(head) || /\btotals?\b/i.test(head)) continue;
    records.push(rec);
  }

  return { records, fields, longFields, labels, writable: sheetsWritable() };
}

/* --------------------------- public showcase -------------------------- */

// Safe data for the public marketing home page — names + counts only.
export async function getPublicShowcase() {
  const [molds, products, clients] = await Promise.all([
    getRecords("molds"), getRecords("products"), getRecords("clients"),
  ]);
  const exclude = new Set(["اتقان", "itqan", "غير محدد", "غير محدّد", "n/a"]);
  const clientNames = Array.from(new Set(clients.records.map((r) => (r.name || "").trim()).filter(Boolean)))
    .filter((n) => !exclude.has(n.toLowerCase()));
  const productList = products.records
    .filter((r) => r.name)
    .slice(0, 30)
    .map((r) => ({ name: r.name, material: r.material || "" }));
  return {
    stats: { molds: molds.records.length, products: products.records.length, clients: clientNames.length },
    clients: clientNames,
    products: productList,
  };
}

/* ------------------------------ writing ------------------------------ */
// Master is the SINGLE SOURCE OF TRUTH. The Molds & Products tabs are linked
// VLOOKUP VIEWS of Master (keyed by the ID / No. column), so writing into their
// cells would overwrite the formula and break the link. Edits to those entities
// are therefore written back to MASTER (located by ID). The Clients tab is plain
// manual data that doesn't exist in Master, so it's edited in place.

export type UpdateResult = { ok: boolean; reason?: string };

type Cell = { row: number; col: number; value: string };

const MASTER_TAB = "Master";
const MASTER_VIEWS = new Set(["molds", "products"]); // entities mirrored from Master
const ID_KEYWORDS = ["id", "الرقم", "رقم", "no."]; // the key column in Master + its views

export async function updateRecord(entity: string, row: number, changes: Record<string, string>): Promise<UpdateResult> {
  if (!SCRIPT_URL || !SCRIPT_SECRET) return { ok: false, reason: "not_writable" };
  const cfg = ENTITIES[entity];
  if (!cfg) return { ok: false, reason: "bad_entity" };
  if (!Number.isFinite(row) || row < 2) return { ok: false, reason: "bad_row" };
  if (!changes || Object.keys(changes).length === 0) return { ok: true }; // nothing changed

  const plan = MASTER_VIEWS.has(entity)
    ? await mapToMaster(cfg, row, changes)
    : await mapInTab(cfg, row, changes);
  if ("reason" in plan) return { ok: false, reason: plan.reason };

  return postUpdates(plan.tab, plan.updates);
}

// Locate the edited record's Master row by its ID, then map fields → Master columns.
async function mapToMaster(
  cfg: EntityConfig, row: number, changes: Record<string, string>,
): Promise<{ tab: string; updates: Cell[] } | { reason: string }> {
  // 1) read the view tab → the ID of the edited row (ID/No. is its first column)
  const view = await fetchSheet(cfg.tab);
  if (view.values.length < 2) return { reason: "empty_view" };
  const viewHeaders = view.values[findHeaderRow(view.values, cfg.fields)] ?? [];
  const viewIdCol = Math.max(0, colIndex(viewHeaders, ID_KEYWORDS));
  const viewRow = view.values[row - 1];
  if (!viewRow) return { reason: "row_not_found" };
  const id = (viewRow[viewIdCol] ?? "").trim();
  if (!id) return { reason: "no_id" };

  // 2) read Master → find the row with that ID; map each field → its Master column
  const master = await fetchSheet(MASTER_TAB);
  if (master.values.length < 2) return { reason: "empty_master" };
  const mh = findHeaderRow(master.values, cfg.fields);
  const mHeaders = master.values[mh] ?? [];
  const mIdCol = Math.max(0, colIndex(mHeaders, ID_KEYWORDS));

  let masterRow = -1;
  for (let i = mh + 1; i < master.values.length; i++) {
    if ((master.values[i][mIdCol] ?? "").trim() === id) { masterRow = i + 1; break; }
  }
  if (masterRow < 0) return { reason: "id_not_in_master" };

  const updates: Cell[] = [];
  for (const [field, value] of Object.entries(changes)) {
    const f = cfg.fields.find((x) => x.key === field);
    if (!f) continue;
    const ci = colIndex(mHeaders, f.keywords);
    if (ci < 0) continue; // field has no Master column → skip
    updates.push({ row: masterRow, col: ci + 1, value: value ?? "" });
  }
  if (updates.length === 0) return { reason: "no_master_fields" };
  return { tab: master.title, updates };
}

// Map fields → columns of the entity's OWN tab (for manual tabs like Clients).
async function mapInTab(
  cfg: EntityConfig, row: number, changes: Record<string, string>,
): Promise<{ tab: string; updates: Cell[] } | { reason: string }> {
  const { values, title } = await fetchSheet(cfg.tab);
  if (values.length < 2) return { reason: "empty_sheet" };
  const headers = values[findHeaderRow(values, cfg.fields)] ?? [];
  const updates: Cell[] = [];
  for (const [field, value] of Object.entries(changes)) {
    const f = cfg.fields.find((x) => x.key === field);
    if (!f) continue;
    const ci = colIndex(headers, f.keywords);
    if (ci < 0) continue;
    updates.push({ row, col: ci + 1, value: value ?? "" });
  }
  if (updates.length === 0) return { reason: "no_fields" };
  return { tab: title, updates };
}

async function postUpdates(tab: string, updates: Cell[]): Promise<UpdateResult> {
  return postAction({ tab, updates });
}

// One POST helper for every write action (updates / append / deleteRow).
async function postAction(payload: Record<string, unknown>): Promise<UpdateResult> {
  try {
    const res = await fetch(SCRIPT_URL!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: SCRIPT_SECRET, ...payload }),
      redirect: "follow",
    });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    return json.ok ? { ok: true } : { ok: false, reason: json.error || "script_error" };
  } catch {
    return { ok: false, reason: "request_failed" };
  }
}

/* ------------------------ appending & deleting ------------------------ */
// For high-volume tabs (Production runs) we add and remove whole rows rather
// than editing single cells. The appended row is ordered to match the tab's
// real header columns, so it survives column reordering in the sheet.

export async function appendRecord(entity: string, values: Record<string, string>): Promise<UpdateResult> {
  if (!SCRIPT_URL || !SCRIPT_SECRET) return { ok: false, reason: "not_writable" };
  const cfg = ENTITIES[entity];
  if (!cfg) return { ok: false, reason: "bad_entity" };

  const { values: sheetVals, title } = await fetchSheet(cfg.tab);
  if (sheetVals.length === 0) return { ok: false, reason: "no_tab" };
  const headers = sheetVals[findHeaderRow(sheetVals, cfg.fields)] ?? [];
  if (headers.length === 0) return { ok: false, reason: "no_headers" };

  // For each real column, find the first field whose keywords match that header
  // and drop in its value; unknown columns are left blank.
  const row = headers.map((hd) => {
    const h = (hd || "").toLowerCase();
    const f = cfg.fields.find((x) => x.keywords.some((k) => h.includes(k)));
    return f ? (values[f.key] ?? "") : "";
  });
  return postAction({ tab: title, append: row });
}

export async function deleteRecord(entity: string, row: number): Promise<UpdateResult> {
  if (!SCRIPT_URL || !SCRIPT_SECRET) return { ok: false, reason: "not_writable" };
  const cfg = ENTITIES[entity];
  if (!cfg) return { ok: false, reason: "bad_entity" };
  if (!Number.isFinite(row) || row < 2) return { ok: false, reason: "bad_row" };
  const { title } = await fetchSheet(cfg.tab); // resolve the tab's real casing
  return postAction({ tab: title, deleteRow: row });
}
