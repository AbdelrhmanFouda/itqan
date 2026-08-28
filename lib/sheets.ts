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

import { revalidateTag } from "next/cache";
import { planRollback, cellRef, type WriteCell } from "@/lib/sheet-write";

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
    tab: "الاسطمبات", titleEn: "Molds Register", titleAr: "حصر الاسطمبات",
    fields: [
      { key: "code", keywords: ["mold code", "code", "كود"] },
      { key: "name", keywords: ["product / mold", "product", "mold name", "name", "المنتج", "اسم الاسطمبة"] },
      { key: "client", keywords: ["client", "العميل"] },
      // worstCycle BEFORE cycle: its header contains "زمن الدورة"/"cycle" too,
      // but only it contains "أسوأ"/"worst".
      { key: "worstCycle", keywords: ["أسوأ", "worst"] },
      { key: "cycle", keywords: ["cycle", "الدورة"] },
      { key: "operator", keywords: ["worker", "operator", "العامل"] },
      { key: "active", keywords: ["active", "نشط", "status"] },
    ],
  },
  products: {
    tab: "المنتجات", titleEn: "Products", titleAr: "المنتجات",
    fields: [
      { key: "name", keywords: ["product", "المنتج"] },
      { key: "client", keywords: ["client", "العميل"] },
      { key: "weight", keywords: ["weight", "الوزن"] },
      { key: "material", keywords: ["material", "الخام"] },
      { key: "cavities", keywords: ["cav", "كافيتي"] },
      { key: "worstCycle", keywords: ["أسوأ", "worst"] },
      { key: "cycle", keywords: ["cycle", "الدورة"] },
      { key: "machine", keywords: ["machine", "الماكينة"] },
      { key: "defects", keywords: ["defect", "العيوب"], long: true },
      { key: "date", keywords: ["date", "التاريخ"] },
    ],
  },
  clients: {
    tab: "العملاء", titleEn: "Clients", titleAr: "العملاء",
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
    tab: "الإنتاج", titleEn: "Production Runs", titleAr: "تشغيلات الإنتاج",
    fields: [
      { key: "date", keywords: ["date", "التاريخ"] },
      { key: "shift", keywords: ["shift", "الوردية"] },
      // machineCode BEFORE machine: its column header ("كود الماكينة\nMachine code")
      // contains both "machine" and "الماكينة", so `machine` would otherwise claim
      // the code column during appends. Value = the physical-machine label
      // ("PQPI 4 — 220") the workbook joins machines on.
      { key: "machineCode", keywords: ["كود الماكينة", "machine code"] },
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
      // «الأجمالي سستم» and «حالة السجل» — added to the tab by the sheet's owner
      // and read here since 2026-08-27, when «تسجيل الإنتاج» was removed from the
      // workbook and this row became the ONLY place a run's scrap lives.
      // systemTotal is the machine counter's total; scrap = سستم − سليم when
      // «هالك» itself is blank. See lib/scrap.ts for the rule.
      { key: "systemTotal", keywords: ["الأجمالي سستم", "system total"] },
      // «سليم / لم يُعد بعد / الفعلي أكبر من العداد» — the sheet's own verdict on
      // whether the row's counts agree. Read, never written.
      { key: "rowCheck", keywords: ["حالة السجل", "row check"] },
      // Cavities actually OPEN during this run (damaged ones get blocked, so the
      // count varies per run). Vestigial — the per-run column was dropped from
      // the final workbook and the hourly board it fed is gone; see CLAUDE.md.
      { key: "openCavities", keywords: ["التجاويف", "open cav"] },
      { key: "downtimeReason", keywords: ["downtime reason", "سبب التوقف", "reason", "سبب"] },
      { key: "downtimeMin", keywords: ["downtime", "زمن التوقف", "توقف"] },
      { key: "operator", keywords: ["operator", "worker", "العامل", "المشغل"] },
      { key: "note", keywords: ["note", "ملاحظ"], long: true },
    ],
  },
  // The machines tab is a REGISTRY: one row per PHYSICAL machine — code
  // (PQPI n, the true unique id: several tonnages exist twice), tonnage,
  // manufacturer, status, current product and shift length. No dates anymore.
  // NOTE: code declared BEFORE name — the code column's header contains
  // "الماكينة" too, so `name` would otherwise claim it during appends.
  // `active` deliberately omits the bare "active" keyword so the trailing
  // "Active on" column stays unclaimed.
  machines: {
    tab: "الماكينات", titleEn: "Machines", titleAr: "الماكينات",
    fields: [
      { key: "code", keywords: ["كود الماكينة", "machine code"] },
      { key: "name", keywords: ["الماكينة", "machine"] },
      { key: "product", keywords: ["أسم المنتج", "اسم المنتج", "prod name", "product"] },
      { key: "manufacturer", keywords: ["الشركة المصنعة", "manufactur"] },
      { key: "shiftLength", keywords: ["طول الوردية", "shift length", "دقيقة"] },
      { key: "active", keywords: ["الحالة", "status"] },
    ],
  },
  // Client work orders. One row per job; progress is COMPUTED from production
  // rows matched by product name + start date (no run⇄job foreign keys).
  jobs: {
    tab: "أوامر العمل", titleEn: "Jobs", titleAr: "أوامر العمل",
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
  // «التوقفات» — the stoppage log, created by ../production/scripts/downtime-tab.gs
  // on 2026-08-14 and now the SOURCE OF TRUTH for downtime. It replaces the
  // Firestore-only `downtimeEvents` collection, which is left holding one thing:
  // the stoppage that is running RIGHT NOW (it has no minutes yet, and !D
  // requires a number greater than zero, so it cannot be a valid row). The row
  // is written when somebody taps stop — see app/api/downtime/route.ts.
  //
  // Header row 1, data from row 2, bilingual "ar\nen" like every other tab.
  // FIELD ORDER IS LOAD-BEARING for appendRecord, which gives each real header
  // to the FIRST field whose keyword it contains, and four of the nine headers
  // contain the word «التوقف»:
  //   • `reason` must come before `minutes`, and matches on «سبب» alone;
  //   • `minutes` therefore matches «زمن التوقف»/«دقيقة», never a bare «التوقف»;
  //   • `start`/`end` match «بداية»/«نهاية» for the same reason.
  // Get that wrong and a stoppage's minutes land in the reason column.
  downtime: {
    tab: "التوقفات", titleEn: "Downtime Log", titleAr: "التوقفات",
    fields: [
      { key: "date", keywords: ["التاريخ", "date"] },
      // The «الماكينات»!J label ("PQ 7 — 100"), from a dropdown. This is the
      // join key to «الإنتاج» — tonnage alone would merge PQ 5 with PQ 7.
      { key: "machine", keywords: ["الماكينة", "machine"] },
      { key: "reason", keywords: ["سبب", "reason"] },
      // The ONLY field anything computes from; the sheet validates it > 0.
      { key: "minutes", keywords: ["زمن التوقف", "دقيقة", "downtime (min)"] },
      { key: "start", keywords: ["بداية", "started"] },
      { key: "end", keywords: ["نهاية", "ended"] },
      { key: "estimated", keywords: ["تقديري", "estimated"] },
      { key: "loggedBy", keywords: ["بواسطة", "logged"] },
      { key: "notes", keywords: ["ملاحظ", "note"], long: true },
    ],
  },
  // Manual faults/issues log — one row per reported problem on the floor.
  // The AI agent's log_issue tool appends here. Headers are unknown/loosely
  // structured on the live sheet, so keywords are deliberately broad; appendRecord
  // maps each real header to the first matching field and leaves the rest blank.
  issues: {
    tab: "الأعطال", titleEn: "Issues Log", titleAr: "سجل الأعطال",
    fields: [
      { key: "date", keywords: ["date", "التاريخ", "التاريح"] },
      { key: "machine", keywords: ["machine", "الماكينة", "الماكينه"] },
      { key: "product", keywords: ["المنتج", "product"] },
      { key: "category", keywords: ["category", "type", "النوع", "التصنيف", "الفئة", "فئة"] },
      { key: "description", keywords: ["description", "الوصف", "البيان", "المشكلة", "العطل", "وصف"], long: true },
      { key: "action", keywords: ["action", "الإجراء", "الاجراء", "المعالجة", "الحل", "إجراء"], long: true },
      { key: "status", keywords: ["status", "الحالة", "الحاله"] },
      { key: "note", keywords: ["note", "ملاحظ"], long: true },
    ],
  },
  // The single source of truth. Read directly when we need the per-mold standards
  // (cycle time + cavities) that OEE's Performance factor depends on.
  master: {
    tab: "الرئيسي", titleEn: "Master", titleAr: "الرئيسي",
    fields: [
      { key: "id", keywords: ["id", "الرقم", "رقم"] },
      { key: "name", keywords: ["product / mold", "المنتج / الاسطمبة", "product", "mold name", "المنتج"] },
      { key: "code", keywords: ["mold code", "كود الاسطمبة", "code", "كود"] },
      { key: "cavities", keywords: ["cavities", "عدد الكافيتي", "cav", "كافيتي"] },
      { key: "worstCycle", keywords: ["أسوأ", "worst"] },
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

// Tabs were renamed to Arabic (2026-07-15). The OLD English names stay as
// fallbacks so the site keeps working whether the sheet-side rename has run
// or not (and survives a rollback). Keyed by the CURRENT (Arabic) tab name.
const TAB_ALIASES: Record<string, string[]> = {
  "الرئيسي": ["Master"],
  "الاسطمبات": ["Molds"],
  "المنتجات": ["Products"],
  "العملاء": ["Clients"],
  "الإنتاج": ["Production", "production"],
  "الماكينات": ["machines", "Machines"],
  "أوامر العمل": ["jobs", "Jobs"],
  "لوحة البيانات": ["Dashboard"],
};

/* ------------------------- the read cache ---------------------------------
 * Measured on production 2026-08-12, with the bridge itself answering every
 * tab in ~2.5s: /api/runs took 71s and returned [], /api/hourly 22s and
 * returned nothing, while «الإنتاج» held 455 rows and «تسجيل الإنتاج» 994.
 *
 * There was no cache at all — every route re-read every tab, `cache: "no-store"`
 * on each. Opening the dashboard fires several routes at once and each reads
 * three or four tabs, so a dozen-plus simultaneous requests hit one Apps Script
 * deployment, which serialises them and starts failing. The failures were then
 * swallowed by the candidate loop's empty catch, so the app rendered "no data"
 * rather than an error. Slow and silently empty are the same bug.
 *
 * Two rules make this safe rather than merely fast:
 *  - NEVER cache an empty result. Pinning a transient failure for a minute
 *    would turn one bad moment into a minute of a blank dashboard — a worse
 *    version of the thing being fixed.
 *  - Writes and pre-write validation must opt out (`fresh`). `commitDraft()`
 *    exists to re-derive row numbers from the sheet as it is RIGHT NOW; letting
 *    it read a minute-old copy would defeat the whole confirm-before-write
 *    guarantee and could write onto a row somebody else just filled.
 */
const SHEET_TTL_SEC = 45;
export const SHEET_CACHE_TAG = "sheet-read";
type SheetRead = { title: string; values: string[][] };
/** Per-instance only, and only to coalesce simultaneous callers. The real
 *  cache is Next's data cache, which is shared across serverless instances —
 *  an in-memory Map is not, which is why a second request that lands on a cold
 *  instance was measured SLOWER than the first. */
const sheetInflight = new Map<string, Promise<SheetRead>>();

/**
 * Tabs the workbook turned out not to have. A tab vanishing is a WORKBOOK
 * change, and until 2026-08-27 the only trace of one was an empty array that
 * looked exactly like an empty tab — «تسجيل الإنتاج» was deleted and the
 * site reported scrap of zero without a word. Recorded here so the readiness
 * panel can SAY so.
 *
 * Per-instance, which is enough: it is populated by the read that just ran in
 * this request, and a tab that is back simply never gets added again.
 */
const MISSING_TABS = new Set<string>();
/** Tab names the bridge has refused as non-existent on this instance. */
export const missingTabs = (): string[] => Array.from(MISSING_TABS);

/** Drop cached reads everywhere — called after any successful write. */
export function invalidateSheetCache(): void {
  sheetInflight.clear();
  try {
    // `updateTag` is the read-your-own-writes primitive, but it is Server
    // Actions only — every write here is a Route Handler, so it is unavailable.
    // `revalidateTag` needs an explicit profile in this version; the bare
    // one-argument form is deprecated. `expire: 0` asks for immediate
    // expiry rather than the stale-while-revalidate of `profile: "max"`,
    // which would show the crew their own edit missing.
    revalidateTag(SHEET_CACHE_TAG, { expire: 0 });
  } catch {
    // Outside a request scope this throws; the in-flight clear still happens,
    // the 45s TTL bounds the staleness, and callers that must not be stale
    // ask for `fresh` anyway.
  }
}

async function fetchSheet(tab: string, fresh = false): Promise<SheetRead> {
  if (fresh) return fetchSheetUncached(tab, true);
  // Route handlers do not get React's per-render fetch memoization, so two
  // routes reading the same tab in the same instant would otherwise be two
  // trips into an Apps Script deployment that serialises them.
  const flying = sheetInflight.get(tab);
  if (flying) return flying;
  const p = fetchSheetUncached(tab, false)
    .finally(() => { if (sheetInflight.get(tab) === p) sheetInflight.delete(tab); });
  sheetInflight.set(tab, p);
  return p;
}

/**
 * One bridge request at a time.
 *
 * The Apps Script deployment executes serially, so firing four tab reads at
 * once does not make them faster — it makes some of them fail. Measured on
 * production 2026-08-12 with the shared cache already in place: a COLD
 * /api/runs, which reads three tabs in a Promise.all, took 45s and returned []
 * while a warm one took 0.7s and returned 154 KB. Racing ourselves was the
 * whole difference between correct and empty.
 *
 * Queueing makes a cold read slower and right rather than fast and wrong; the
 * 45s cache means almost nobody pays it.
 */
let bridgeQueue: Promise<unknown> = Promise.resolve();
function queued<T>(fn: () => Promise<T>): Promise<T> {
  const run = bridgeQueue.then(fn, fn);
  bridgeQueue = run.then(() => undefined, () => undefined);
  return run;
}

async function fetchSheetUncached(tab: string, fresh: boolean): Promise<SheetRead> {
  // Preferred: Apps Script (works on a private sheet, no API key).
  // getSheetByName() in the script is CASE-SENSITIVE and the sheet's tab names
  // have drifted between "Production"/"production" etc., so retry casings and
  // the pre-rename English aliases.
  if (SCRIPT_URL && SCRIPT_SECRET) {
    const lower = tab.toLowerCase();
    const cap = lower.charAt(0).toUpperCase() + lower.slice(1);
    const candidates = Array.from(new Set([tab, ...(TAB_ALIASES[tab] ?? []), lower, cap, tab.toUpperCase()]));
    // The real tab name first, then aliases, then one more go at the real name
    // after a pause — a bridge that refused because it was busy will usually
    // answer a moment later, and the alternative is handing the UI an empty
    // page that looks exactly like "there is no data".
    const plan: (string | number)[] = [...candidates, 1500, tab, 4000, tab];
    let lastProblem = "";
    // The bridge answers `{"error":"no_tab"}` when the workbook has no sheet by
    // that name. That is a DEFINITIVE answer, not a throttled one: waiting 1.5s
    // and 4s to ask the same question twice more cannot change it. Counting
    // them lets the loop give up once every candidate name has been refused.
    //
    // Measured cost of not doing this: «تسجيل الإنتاج» was removed from the
    // workbook on 2026-08-27, and until this route stopped asking for it, every
    // uncached read that loaded it — /api/runs, /api/oee, /api/hourly,
    // /api/jobs/[id] — spent 5.5s asleep plus five wasted bridge calls before
    // returning the empty array it already had after the first one.
    let refused = 0;
    for (const step of plan) {
      if (typeof step === "number") {
        if (refused >= candidates.length) break; // every name refused — no point waiting
        await new Promise((r) => setTimeout(r, step));
        continue;
      }
      const name = step;
      try {
        const u = `${SCRIPT_URL}?token=${encodeURIComponent(SCRIPT_SECRET)}&tab=${encodeURIComponent(name)}`;
        // `revalidate` and `cache: "no-store"` conflict — Next ignores BOTH if
        // they are set together, which would silently disable the cache. Pick
        // exactly one.
        const res = await queued(() =>
          fetch(u, {
            redirect: "follow",
            ...(fresh
              ? { cache: "no-store" as const }
              : { next: { revalidate: SHEET_TTL_SEC, tags: [SHEET_CACHE_TAG] } }),
          }),
        );
        if (res.ok) {
          // Under load the bridge answers with an HTML error page, not JSON.
          // Parsing that threw into an empty catch, which is how a throttled
          // moment became a silently blank dashboard.
          const body = await res.text();
          try {
            const json = JSON.parse(body) as { values?: string[][]; error?: string };
            if (json.values && json.values.length > 0) return { title: name, values: json.values };
            if (json.error === "no_tab") {
              refused++;
              lastProblem = `"${name}" is not a tab in the workbook`;
            } else lastProblem = `"${name}" returned no rows`;
          } catch {
            lastProblem = `"${name}" returned ${body.trim().startsWith("<") ? "an HTML error page (bridge throttled?)" : "unparseable output"}`;
          }
        } else {
          lastProblem = `"${name}" HTTP ${res.status}`;
        }
      } catch (e) {
        lastProblem = `"${name}" ${e instanceof Error ? e.message : "request failed"}`;
      }
    }
    // Loud, because the caller cannot tell "tab is empty" from "read failed" —
    // both arrive as [] — and the UI will render an empty page either way.
    if (refused >= candidates.length) {
      // A tab that does not exist is a WORKBOOK change, not an outage. Say so
      // in those words: the last time this happened the message read like a
      // transient failure and the real event — a tab deleted from the sheet —
      // took a fresh survey to notice.
      MISSING_TABS.add(tab);
      console.error(`[sheets] tab "${tab}" does not exist in the workbook (tried: ${candidates.join(", ")}). Was it renamed or deleted?`);
      return { title: tab, values: [] };
    }
    console.error(`[sheets] every attempt failed for tab "${tab}" (last: ${lastProblem})`);
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

/**
 * Lowercase a header for keyword matching, zero-padding a bare hour label.
 *
 * «تسجيل الإنتاج» labels its 24 hour columns 8:00, 9:00, 10:00 … 07:00 — only
 * the first two lack the leading zero (00:00–07:00 ARE padded). ENTITIES.hourly
 * matches the literal "08:00"/"09:00", so exactly those two columns were dropped
 * and the hourly viewer showed 22 of 24 hours. Padding here fixes both.
 *
 * The lookahead-free form only rewrites a single digit that has no digit before
 * it, so "11:00" and "21:00" are left alone.
 */
function normHeader(h: string | undefined): string {
  return (h || "").toLowerCase().replace(/(^|[^\d])(\d):(\d{2})/g, "$10$2:$3");
}

function colIndex(headers: string[], keywords: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = normHeader(headers[i]);
    if (keywords.some((k) => h.includes(k))) return i;
  }
  return -1;
}

function findHeaderRow(values: string[][], fields: FieldDef[]): number {
  let best = values.length > 1 ? 1 : 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(values.length, 8); i++) {
    const row = values[i].map(normHeader);
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

export async function getRecords(
  entity: string,
  opts: { fresh?: boolean } = {},
): Promise<RecordsResult> {
  const cfg = ENTITIES[entity];
  const empty: RecordsResult = { records: [], fields: [], longFields: [], labels: {}, writable: sheetsWritable() };
  if (!cfg) return empty;

  const { values } = await fetchSheet(cfg.tab, opts.fresh);
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

// Safe data for the public marketing home page — COUNTS ONLY.
// This used to return 30 real product names and the full client list; the
// landing page stopped showing product names at the owner's word (90ab433,
// 2026-08-27) but the endpoint kept serving them to anyone who asked. Closed
// 2026-08-28: nothing public gets a name, only the three numbers the Hero
// shows. If the «أعمالنا» section ever comes back, it must be fed genericized
// content — not this endpoint.
// Molds and Products are both formula views of Master, so their counts are
// always IDENTICAL — showing both read as a bug on the Hero. Machines (the
// «الماكينات» registry, one row per physical machine) replaced products.
export async function getPublicShowcase() {
  const [molds, machines, clients] = await Promise.all([
    getRecords("molds"), getRecords("machines"), getRecords("clients"),
  ]);
  // The exclude list keeps the count honest (the factory itself and filler
  // rows are not clients), even though the names themselves never leave.
  const exclude = new Set(["اتقان", "itqan", "غير محدد", "غير محدّد", "n/a"]);
  const clientCount = Array.from(new Set(clients.records.map((r) => (r.name || "").trim()).filter(Boolean)))
    .filter((n) => !exclude.has(n.toLowerCase())).length;
  return {
    stats: { molds: molds.records.length, machines: machines.records.length, clients: clientCount },
  };
}

/* ------------------------------ writing ------------------------------ */
// Master is the SINGLE SOURCE OF TRUTH. The Molds & Products tabs are linked
// VLOOKUP VIEWS of Master (keyed by the ID / No. column), so writing into their
// cells would overwrite the formula and break the link. Edits to those entities
// are therefore written back to MASTER (located by ID). The Clients tab is plain
// manual data that doesn't exist in Master, so it's edited in place.

export type UpdateResult = {
  ok: boolean;
  reason?: string;
  /**
   * Set only when a write FAILED after partly landing — see postUpdates().
   * `applied` cells were written before the bridge threw; `rolledBack` of those
   * were put back; `stranded` could not be restored honestly and are still
   * holding the new value. A caller that reports "failed" without mentioning a
   * non-zero `stranded` is telling the user something untrue.
   */
  applied?: number;
  rolledBack?: number;
  stranded?: string[];
};

type Cell = { row: number; col: number; value: string };

const MASTER_TAB = "الرئيسي"; // resolved through TAB_ALIASES → falls back to "Master"
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

  return postUpdates(plan.tab, plan.updates, plan.before);
}

/**
 * Update SEVERAL rows of one tab in a SINGLE bridge POST.
 *
 * ⚠ NOTHING CALLS THIS TODAY. Its only caller was the paper-photo import,
 * removed on 2026-08-19. It is kept rather than deleted because the write path
 * for "two numbers per machine per shift" needs exactly this shape — several
 * rows of «تسجيل الإنتاج» filled in one request — and because the semantics
 * below were expensive to establish. If that write path is abandoned too,
 * delete this with it rather than leaving it to rot.
 *
 * The bridge takes `updates:[{row,col,value}]` across arbitrary rows, so a
 * ten-row import is one request instead of ten. That matters here for two
 * reasons: `/exec` returns HTML error pages under load (ten sequential POSTs is
 * ten chances to hit one), and a half-applied import is far worse than a failed
 * one.
 *
 * ⚠️ **This used to claim the rows "land together or not at all". That was only
 * ever true of a network failure.** A single POST is one request, not one
 * transaction: the bridge loops `setValue`, `setValue` enforces data validation,
 * and a rejected cell throws with everything before it already committed —
 * measured on 2026-08-14. `postUpdates()` now snapshots the target cells, and on
 * failure re-reads, rolls back what it can restore honestly and reports the rest
 * as `stranded`. The nearest thing to atomicity available over a bridge that
 * offers none.
 *
 * Master-view entities are refused outright: their writes must go through
 * `mapToMaster`'s identity check, and silently doing the wrong thing in bulk is
 * exactly the failure this codebase has already paid for once.
 */
export async function updateRecordsInTab(
  entity: string,
  edits: { row: number; changes: Record<string, string> }[],
): Promise<UpdateResult & { cells?: number }> {
  if (!SCRIPT_URL || !SCRIPT_SECRET) return { ok: false, reason: "not_writable" };
  const cfg = ENTITIES[entity];
  if (!cfg) return { ok: false, reason: "bad_entity" };
  if (MASTER_VIEWS.has(entity)) return { ok: false, reason: "master_view_not_supported" };
  if (edits.length === 0) return { ok: true, cells: 0 };
  if (edits.some((e) => !Number.isFinite(e.row) || e.row < 2)) return { ok: false, reason: "bad_row" };

  const { values, title } = await fetchSheet(cfg.tab, true);
  if (values.length < 2) return { ok: false, reason: "empty_sheet" };
  const headers = values[findHeaderRow(values, cfg.fields)] ?? [];

  const updates: Cell[] = [];
  for (const { row, changes } of edits) {
    for (const [field, value] of Object.entries(changes)) {
      const f = cfg.fields.find((x) => x.key === field);
      if (!f) return { ok: false, reason: `unknown_field:${field}` };
      const ci = colIndex(headers, f.keywords);
      // A field with no column is a silent data loss in bulk — refuse instead.
      if (ci < 0) return { ok: false, reason: `no_column:${field}` };
      updates.push({ row, col: ci + 1, value: value ?? "" });
    }
  }
  if (updates.length === 0) return { ok: true, cells: 0 };
  // The snapshot comes from the SAME fresh read the columns were resolved from,
  // so a rollback compares like with like.
  const res = await postUpdates(title, updates, readCells(values, updates));
  return { ...res, cells: updates.length };
}

// Locate the edited record's Master row by its ID, then map fields → Master columns.
async function mapToMaster(
  cfg: EntityConfig, row: number, changes: Record<string, string>,
): Promise<{ tab: string; updates: Cell[]; before: string[] } | { reason: string }> {
  // 1) read the view tab → the ID of the edited row (ID/No. is its first column)
  const view = await fetchSheet(cfg.tab, true);
  if (view.values.length < 2) return { reason: "empty_view" };
  const viewHeaders = view.values[findHeaderRow(view.values, cfg.fields)] ?? [];
  const viewIdCol = Math.max(0, colIndex(viewHeaders, ID_KEYWORDS));
  const viewRow = view.values[row - 1];
  if (!viewRow) return { reason: "row_not_found" };
  const id = (viewRow[viewIdCol] ?? "").trim();
  if (!id) return { reason: "no_id" };

  // 2) read Master → find the row with that ID; map each field → its Master column
  const master = await fetchSheet(MASTER_TAB, true);
  if (master.values.length < 2) return { reason: "empty_master" };
  const mh = findHeaderRow(master.values, cfg.fields);
  const mHeaders = master.values[mh] ?? [];
  const mIdCol = Math.max(0, colIndex(mHeaders, ID_KEYWORDS));

  let masterRow = -1;
  for (let i = mh + 1; i < master.values.length; i++) {
    if ((master.values[i][mIdCol] ?? "").trim() === id) { masterRow = i + 1; break; }
  }
  if (masterRow < 0) return { reason: "id_not_in_master" };

  // ── Identity check: the ID alone is NOT trustworthy ──────────────────────
  // «الاسطمبات» and «المنتجات» compute their ID as ROW()-2 of the VIEW's own
  // row, so each #REF! break shifts every row beneath it and the ID silently
  // stops agreeing with Master. Verified live 2026-08-09: both views break at
  // rows 435, 459, 473, 478 and 488, and 45 products carry an ID that belongs
  // to a DIFFERENT Master row (view row 440 shows «الجردل» with id 438, which is
  // «قاعدة» in Master). Writing by that ID edits the wrong product.
  //
  // The product NAME is the real identity — it is what every operational tab
  // joins on. So: verify the name; if it disagrees, re-resolve by name; and if
  // the name is missing or matches more than one Master row, refuse the write
  // rather than corrupt a row. Both sides are normalized the SAME way, because
  // some names carry a trailing tab («زراير») or space («قاعدة ») from the
  // dropdown and one-sided trimming would break an otherwise good match.
  const nameField = cfg.fields.find((f) => f.key === "name");
  if (nameField) {
    const vNameCol = colIndex(viewHeaders, nameField.keywords);
    const mNameCol = colIndex(mHeaders, nameField.keywords);
    if (vNameCol >= 0 && mNameCol >= 0) {
      const norm = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
      const viewName = norm(viewRow[vNameCol]);
      if (!viewName) return { reason: "no_name_to_verify" };

      if (norm(master.values[masterRow - 1]?.[mNameCol]) !== viewName) {
        const hits: number[] = [];
        for (let i = mh + 1; i < master.values.length; i++) {
          if (norm(master.values[i][mNameCol]) === viewName) hits.push(i + 1);
        }
        // Exactly one Master row owns this name → that is the row to edit.
        // Zero or several → we cannot know which product the user meant.
        if (hits.length !== 1) return { reason: "identity_mismatch" };
        masterRow = hits[0];
      }
    }
  }

  const updates: Cell[] = [];
  for (const [field, value] of Object.entries(changes)) {
    const f = cfg.fields.find((x) => x.key === field);
    if (!f) continue;
    const ci = colIndex(mHeaders, f.keywords);
    if (ci < 0) continue; // field has no Master column → skip
    updates.push({ row: masterRow, col: ci + 1, value: value ?? "" });
  }
  if (updates.length === 0) return { reason: "no_master_fields" };
  return { tab: master.title, updates, before: readCells(master.values, updates) };
}

// Map fields → columns of the entity's OWN tab (for manual tabs like Clients).
async function mapInTab(
  cfg: EntityConfig, row: number, changes: Record<string, string>,
): Promise<{ tab: string; updates: Cell[]; before: string[] } | { reason: string }> {
  const { values, title } = await fetchSheet(cfg.tab, true);
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
  return { tab: title, updates, before: readCells(values, updates) };
}

/** The display value each target cell held in a snapshot of the tab. */
function readCells(values: string[][], cells: Cell[]): string[] {
  return cells.map((c) => (values[c.row - 1]?.[c.col - 1] ?? ""));
}

/**
 * Send a cell batch, and if it fails, find out what it did anyway.
 *
 * The bridge's `updates` action is a bare `forEach` of `setValue`, and
 * `setValue` ENFORCES data validation. One rejected cell throws out of
 * `doPost`, the cells before it stay committed, the cells after it are dropped,
 * and the caller is handed an HTML error page. Both halves of that are silent.
 *
 * So: `before` is a snapshot of these exact cells taken from the fresh read the
 * caller already did. On failure this re-reads, asks `planRollback()` what
 * actually moved, puts back everything it can restore honestly, and REPORTS
 * whatever it cannot (see lib/sheet-write.ts for why a date cannot be restored
 * from a display value in this workbook). The result carries `applied`,
 * `rolledBack` and `stranded` so no caller can report a clean failure over a
 * row that is half-written.
 *
 * Callers that pass no `before` get the old behaviour, which is correct for a
 * batch that cannot half-apply — a single cell.
 *
 * ⚠ This is recovery, not prevention. The prevention lives in the bridge, which
 * now wraps the same loop in a try/catch and restores the UNDERLYING values
 * (see apps-script.gs) — but only once the owner deploys a new version. Until
 * then this is the whole safety net, and it stays useful afterwards because it
 * also catches the bridge's at-least-once replies.
 */
async function postUpdates(tab: string, updates: Cell[], before?: string[]): Promise<UpdateResult> {
  const res = await postAction({ tab, updates });
  if (res.ok || !before || updates.length < 2) return res;
  // A new-enough bridge already rolled the batch back itself and told us so.
  // Its report is authoritative — it saw the underlying values — and anything
  // it could not restore, this cannot either: the undo failed because the sheet
  // refuses the ORIGINAL value, which is equally true from here.
  if (res.stranded) return res;

  // Did it half-apply? Read the same cells back and compare.
  let after: string[];
  try {
    const fresh = await fetchSheet(tab, true);
    if (fresh.values.length === 0) return res; // cannot tell; leave the failure as it stands
    after = readCells(fresh.values, updates);
  } catch {
    return res;
  }

  const plan = planRollback(updates as WriteCell[], before, after);
  if (plan.applied === 0) return res; // clean failure — nothing landed

  let rolledBack = 0;
  if (plan.restore.length > 0) {
    const undo = await postAction({ tab, updates: plan.restore });
    if (undo.ok) rolledBack = plan.restore.length;
    else {
      console.error(
        `[sheets] ROLLBACK FAILED on "${tab}" — ${plan.restore.length} cell(s) are still ` +
          `holding a value from a write that was rejected: ${plan.restore.map(cellRef).join(", ")}`,
      );
    }
  }
  // The tab changed even though the write "failed", so a cached copy is a lie.
  invalidateSheetCache();

  const stranded = plan.stranded.map(cellRef);
  console.error(
    `[sheets] partial write on "${tab}": ${plan.applied} of ${updates.length} cell(s) landed ` +
      `before the bridge rejected one (${res.reason}); ${rolledBack} rolled back` +
      (stranded.length ? `; NOT restorable, still changed: ${stranded.join(", ")}` : ""),
  );

  return {
    ok: false,
    reason: res.reason,
    applied: plan.applied,
    rolledBack,
    stranded,
  };
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
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean; error?: string;
      // Only from a bridge new enough to roll a rejected batch back itself.
      at?: string | null; message?: string; rolledBack?: number; notRolledBack?: string[];
    };
    // A stale copy after a successful write would show the crew their own
    // edit missing for the rest of the TTL.
    if (json.ok) invalidateSheetCache();
    if (json.ok) return { ok: true };

    // A deployed-since-2026-08-14 bridge tells us which cell it refused and
    // whether it undid the rest. Pass that through instead of flattening it to
    // "script_error" — and if it says it did NOT fully roll back, that is
    // stranded data and must not read as a clean failure.
    if (json.error === "cell_rejected") {
      const undone = (json.notRolledBack ?? []).length === 0;
      // `at` is usually null and that is not a bug in the bridge: Apps Script
      // BUFFERS writes, so the rejection surfaces at flush() — after the loop
      // has run past the offending cell — not on the setValue itself. Sheets'
      // own message names the cell, and lists the values the column will
      // accept, which is the single most useful line in the whole failure.
      const at = json.at || (json.message?.match(/\bcell\s+([A-Z]+\d+)\b/)?.[1] ?? "");
      console.error(
        `[sheets] "${String(payload.tab ?? "?")}" refused a value` +
          `${at ? ` at ${at}` : ""}${undone ? " (batch rolled back)" : ""}` +
          `${json.message ? `: ${json.message}` : ""}`,
      );
      if (!undone) {
        console.error(
          `[sheets] bridge could not undo its own rejected batch on "${String(payload.tab ?? "?")}": ` +
            `${json.notRolledBack?.join(", ")}`,
        );
      }
      return {
        ok: false,
        reason: `cell_rejected${at ? `@${at}` : ""}`,
        ...(undone ? {} : { applied: json.notRolledBack?.length, rolledBack: json.rolledBack, stranded: json.notRolledBack }),
      };
    }
    return { ok: false, reason: json.error || "script_error" };
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

  const { values: sheetVals, title } = await fetchSheet(cfg.tab, true);
  if (sheetVals.length === 0) return { ok: false, reason: "no_tab" };
  const headers = sheetVals[findHeaderRow(sheetVals, cfg.fields)] ?? [];
  if (headers.length === 0) return { ok: false, reason: "no_headers" };

  // For each real column, find the first field whose keywords match that header
  // and drop in its value; unknown columns are left blank.
  const row = headers.map((hd) => {
    const h = normHeader(hd);
    const f = cfg.fields.find((x) => x.keywords.some((k) => h.includes(k)));
    return f ? (values[f.key] ?? "") : "";
  });
  return postAction({ tab: title, append: row });
}

// Ask the bridge to create a tab (with a header row) if it doesn't exist yet.
// Requires the createTab action in apps-script.gs (deploy a New version to enable);
// on an older deployment this returns no_tab and callers fall back gracefully.
export async function ensureTab(tab: string, headers: string[]): Promise<UpdateResult> {
  if (!SCRIPT_URL || !SCRIPT_SECRET) return { ok: false, reason: "not_writable" };
  return postAction({ createTab: tab, headers });
}

export async function deleteRecord(entity: string, row: number): Promise<UpdateResult> {
  if (!SCRIPT_URL || !SCRIPT_SECRET) return { ok: false, reason: "not_writable" };
  const cfg = ENTITIES[entity];
  if (!cfg) return { ok: false, reason: "bad_entity" };
  if (!Number.isFinite(row) || row < 2) return { ok: false, reason: "bad_row" };
  const { title } = await fetchSheet(cfg.tab, true); // resolve the tab's real casing
  return postAction({ tab: title, deleteRow: row });
}
