/**
 * The sheet's SHAPE, as the site understands it — every tab's field list and
 * the header-matching rules that turn a real header row into column indexes.
 *
 * Moved out of lib/sheets.ts on 2026-09-04 so that it can be tested WITHOUT a
 * bridge: this module imports nothing, so Node's test runner loads it directly
 * and tests/sheet-entities.test.ts can pin, for every tab, which column each
 * field resolves to against the header rows the live workbook actually has —
 * and, in the other direction, which field each real header hands its value to
 * during an append. Both directions have bitten before (CLAUDE.md: "New column
 * names in a tab can hijack appendRecord"; the 8:00/9:00 columns; downtime's
 * four headers that all contain «التوقف»), and until now nothing pinned them.
 *
 * lib/sheets.ts re-exports ENTITIES and EntityConfig, so importers of those
 * are unchanged. Nothing here reads the network.
 */

/* --------------------------- entity configs --------------------------- */

export type FieldDef = { key: string; keywords: string[]; long?: boolean };
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
      // J «تسمية الماكينة / Machine Label (auto)» is the COMPUTED identity
      // column («PQ 7 — 100»). Declared BEFORE `name` so that an append hands
      // that header to THIS field (whose value is never supplied → the cell is
      // left empty) instead of to `name`, whose keywords «الماكينة»/«machine»
      // the header also contains. Found by tests/sheet-entities.test.ts on
      // 2026-09-04: until then "Add machine" wrote the tonnage («220») into J,
      // over the formula that builds the label every join keys on. Read side:
      // `name` still resolves to B first, since headers are scanned in order.
      { key: "label", keywords: ["تسمية الماكينة", "machine label"] },
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
      // B «العميل / Customer», E «الفئة / Category» and Q «ملاحظات / Notes»
      // are read since 2026-09-04 for the mould register: the register shows
      // the client and category, and Q is where 26 products keep a customer's
      // mould number (lib/mold-number.ts). Master is never appended to.
      { key: "client", keywords: ["العميل", "customer", "client"] },
      { key: "name", keywords: ["product / mold", "المنتج / الاسطمبة", "product", "mold name", "المنتج"] },
      { key: "code", keywords: ["mold code", "كود الاسطمبة", "code", "كود"] },
      { key: "category", keywords: ["الفئة", "category"] },
      { key: "cavities", keywords: ["cavities", "عدد الكافيتي", "cav", "كافيتي"] },
      { key: "worstCycle", keywords: ["أسوأ", "worst"] },
      { key: "cycle", keywords: ["cycle", "زمن الدورة", "الدورة"] },
      { key: "weight", keywords: ["الوزن", "weight"] },
      { key: "material", keywords: ["نوع الخام", "material"] },
      { key: "defects", keywords: ["العيوب", "defect"], long: true },
      { key: "machine", keywords: ["machine", "الماكينة"] },
      { key: "active", keywords: ["active", "نشط"] },
      { key: "notes", keywords: ["ملاحظ", "note"], long: true },
    ],
  },
};


/* ----------------------- header matching (pure) ----------------------- */

const NA = new Set(["", "n/a", "na", "غير متاح", "غير متاح / n/a", "n/a / غير متاح", "-", "—", "–"]);
export function clean(v: string | undefined): string {
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
export function normHeader(h: string | undefined): string {
  return (h || "").toLowerCase().replace(/(^|[^\d])(\d):(\d{2})/g, "$10$2:$3");
}

export function colIndex(headers: string[], keywords: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = normHeader(headers[i]);
    if (keywords.some((k) => h.includes(k))) return i;
  }
  return -1;
}

export function findHeaderRow(values: string[][], fields: FieldDef[]): number {
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
export function splitLabel(h: string): { en: string; ar: string } {
  const s = (h || "").trim();
  const parts = s.split(/\n+/).map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 2) return { ar: parts[0], en: parts[1] };
  return { en: s, ar: s };
}
