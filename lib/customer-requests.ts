/**
 * «طلبات العملاء» — the rules a customer's order request obeys.
 *
 * A request is NOT a work order. Any row in «أوامر العمل» is an OPEN ORDER the
 * moment it exists: it is counted in the open-orders tile, offered a one-tap
 * «ابدأ التشغيل», and — wherever the product has a warehouse line — its
 * kilograms are subtracted from «المتاح» on /dashboard/stock before anybody
 * agreed to make it. Column K accepts four validated words and the code throws
 * on a fifth, so "awaiting approval" has no legal home there. Hence a tab of
 * its own, and hence this module: the tab's shape, its four states, its
 * reference number, its replay key and the two whitelists that decide what a
 * buyer is allowed to read back.
 *
 * Pure and import-free on purpose, like lib/work-orders.ts and lib/scrap.ts:
 * Node's test runner loads it directly (tests/customer-requests.test.ts), so
 * the routes, the portal pages and the approval screen share ONE reading of
 * each rule instead of three. `Intl` is a global, not an import, so the Cairo
 * clock lives here too.
 */

/* ------------------------------- the tab --------------------------------- */

/** The tab's name. ENTITIES.customerRequests.tab must equal this (pinned). */
export const REQUEST_TAB = "طلبات العملاء";

/**
 * The header row `ensureTab` writes when the tab does not exist yet, bilingual
 * "ar\nen" like every other tab, data from row 2.
 *
 * The wording is load-bearing in BOTH directions, because lib/sheet-entities.ts
 * matches by containment: on a read each field takes the first header that
 * contains one of its keywords, and on an append each header is handed to the
 * first field whose keyword it contains. Four collisions were designed out
 * here rather than discovered in the sheet:
 *
 *  - the three date columns carry their full phrase — «تاريخ الطلب» ·
 *    «التاريخ المطلوب» · «تاريخ القرار» — and never a bare «تاريخ»;
 *  - the two quantity columns are «العدد المطلوب» and «الكمية بالكيلو», so
 *    neither a bare «الكمية» nor a bare `qty` can claim the wrong one;
 *  - the state column is «حالة الطلب», never «الحالة»;
 *  - D is «اسم العميل / Client Name», NOT «العميل / Client». C «رقم العميل /
 *    Client No.» comes first and literally CONTAINS the string «العميل\nclient»
 *    («رقم » + it + « no.»), so a `client` field keyed on «العميل» would read
 *    the client NUMBER out of C — and every order a buyer owns would fail the
 *    match and vanish from their portal. Declaring clientNo first fixes the
 *    APPEND direction only; no substring of «العميل / Client» is absent from
 *    «رقم العميل / Client No.», so the read direction can only be fixed by
 *    making the two headers genuinely different words. (Deviation from the
 *    build contract's header table, deliberate — same column, same field key,
 *    same order.)
 *
 * No data validation is put on this tab: the bridge enforces validation on
 * `updates` and ignores it on `append`, so a dropdown here would protect the
 * owner typing in the sheet and endanger the site's own writes.
 */
export const REQUEST_HEADERS: string[] = [
  "رقم الطلب\nRequest No.",
  "تاريخ الطلب\nSubmitted On",
  "رقم العميل\nClient No.",
  "اسم العميل\nClient Name",
  "المنتج\nProduct",
  "رقم الصف في الرئيسي\nMaster Row",
  "العدد المطلوب\nQuantity Asked",
  "الوحدة\nUnit",
  "الكمية بالكيلو\nQty Kg",
  "التاريخ المطلوب\nWanted Date",
  "ملاحظات\nNote",
  "حالة الطلب\nRequest State",
  "سبب الرفض\nReject Reason",
  "كود أمر العمل\nWork Order Code",
  "بواسطة\nDecided By",
  "تاريخ القرار\nDecided On",
];

/* -------------------------------- states --------------------------------- */

/**
 * The four states, the portal's OWN vocabulary — deliberately not the four
 * words «أوامر العمل»!K accepts. English stays the internal token, Arabic is
 * the sheet's wire format, and the two map at the boundary exactly as job
 * statuses do (lib/prod-meta.ts).
 */
export const REQUEST_STATES = ["pending", "accepted", "rejected", "cancelled"] as const;
export type RequestState = (typeof REQUEST_STATES)[number];

const STATE_AR: Record<RequestState, string> = {
  pending: "قيد المراجعة",
  accepted: "مقبول",
  rejected: "مرفوض",
  cancelled: "ألغاه العميل",
};
const STATE_EN: Record<string, RequestState> = {
  "قيد المراجعة": "pending",
  "مقبول": "accepted",
  "مرفوض": "rejected",
  "ألغاه العميل": "cancelled",
};

/** Is this one of the four canonical tokens? */
export const isRequestState = (v: string): v is RequestState =>
  (REQUEST_STATES as readonly string[]).includes(v);

/**
 * Sheet → app. An unknown word PASSES THROUGH unchanged — a state typed by
 * hand in the sheet must render as itself, not silently become «قيد المراجعة»
 * and make a decided request look open again. A blank cell is a new row that
 * nobody has decided: pending.
 */
export function requestStateFromSheet(v: string | null | undefined): string {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "pending";
  return STATE_EN[s] ?? s;
}

/**
 * App → sheet. An unknown token THROWS rather than being guessed at: this is
 * the value the customer's own screen reads back, and a word nobody maps would
 * leave a request stuck in a state no screen can explain. Callers gate on
 * `isRequestState` and answer a clean validation error; the throw is the
 * backstop for a caller that forgets.
 */
export function requestStateToSheet(v: string): string {
  if (!isRequestState(v)) {
    throw new Error(
      `unknown request state ${JSON.stringify(v)} — «طلبات العملاء»!L holds only: ${REQUEST_STATES.join(" · ")}`,
    );
  }
  return STATE_AR[v];
}

/** A request the customer may still withdraw (owner's decision 5). */
export const isCancellable = (state: string): boolean => state === "pending";

/* ------------------------------ the clock -------------------------------- */

/** Arabic-Indic / Persian digits → ASCII. Copied (zero imports) from lib/dates.ts. */
export function latinDigits(s: string): string {
  return String(s ?? "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * «yyyy-mm-dd HH:MM» in Cairo — what B «تاريخ الطلب» and P «تاريخ القرار»
 * hold, as TEXT. The factory reads this column with its eyes; a locale-shaped
 * stamp would read differently to the owner than to the site.
 */
export function cairoStamp(now: number = Date.now()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Cairo",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date(now));
    const get = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
    const hh = get("hour") === "24" ? "00" : get("hour");
    return `${get("year")}-${get("month")}-${get("day")} ${hh}:${get("minute")}`;
  } catch {
    return new Date(now).toISOString().slice(0, 16).replace("T", " ");
  }
}

/** The Cairo year — the middle of a reference number. */
export const cairoYear = (now: number = Date.now()): number => Number(cairoStamp(now).slice(0, 4));

/**
 * A stamp as whole minutes, for comparing two stamps.
 *
 * Both sides are Cairo wall-clock text and are read as if they were UTC, so
 * the DIFFERENCE is exact except across a daylight-saving jump — which, at the
 * fifteen-minute granularity this is used for, costs at worst one duplicate
 * request twice a year. Converting properly would need a timezone database
 * this module cannot import.
 *
 * ⚠ IT DOES NOT COME BACK THE WAY IT WENT IN. The site writes «yyyy-mm-dd
 * HH:MM» as text, but both transports enter it USER_ENTERED — `appendRow` on
 * the bridge, `valueInputOption=USER_ENTERED` on the Sheets API — so Sheets
 * parses it into a DateTime cell and every read hands back the workbook's own
 * rendering of it: `9/23/2026 14:05:00`. A strict ISO match therefore returned
 * null for every row in the tab, `findReplay` skipped them all, and the
 * at-least-once replay protection was INERT — a retried submit from a phone on
 * factory wifi would have written a second request row with a new reference
 * number. (`wantedDate` was already put through `normalizeDate` on read for
 * exactly this reason; these two stamps were not.)
 *
 * So the shapes are all accepted here: ISO, the m/d/yyyy or d/m/yyyy the
 * workbook renders (the same rule `normalizeDate` uses — whichever part
 * exceeds 12 wins, else the zero-padding tell), an optional seconds part, and
 * a leading apostrophe from a text-forced cell. Unparseable is still null.
 * `normalizeStamp` in lib/customer-requests-data.ts puts every row back into
 * the canonical shape on read, so sorting and `slice(0,10)` stay honest too.
 */
export function stampMinutes(stamp: string | null | undefined): number | null {
  const s = latinDigits(String(stamp ?? "")).replace(/^'/, "").replace(/\s+/g, " ").trim();
  const t = s.match(/(\d{1,2}):(\d{2})/);
  if (!t) return null;
  const hh = +t[1], mi = +t[2];
  if (hh > 23 || mi > 59) return null;

  const datePart = s.slice(0, t.index).trim().replace(/[T,]$/, "").trim();
  let y = 0, mo = 0, d = 0;
  let m = datePart.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) {
    [y, mo, d] = [+m[1], +m[2], +m[3]];
  } else {
    m = datePart.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (!m) return null;
    const a = +m[1], b = +m[2];
    y = +m[3];
    if (a > 12 && b <= 12) { d = a; mo = b; }          // day-first
    else if (b > 12 && a <= 12) { mo = a; d = b; }     // month-first
    else if (m[1].length === 2) { d = a; mo = b; }     // padded text = day-first
    else { mo = a; d = b; }                            // Sheets-rendered = month-first
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return Math.round(Date.UTC(y, mo - 1, d, hh, mi) / 60000);
}

/** Two digits, for rebuilding a stamp. */
const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * Any stamp the tab can hand back → the canonical «yyyy-mm-dd HH:MM», or ""
 * when it cannot be read. Built on `stampMinutes`, so the two can never
 * disagree about what a cell means.
 */
export function canonicalStamp(stamp: string | null | undefined): string {
  const mins = stampMinutes(stamp);
  if (mins === null) return "";
  const dt = new Date(mins * 60000);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())} ` +
    `${pad2(dt.getUTCHours())}:${pad2(dt.getUTCMinutes())}`;
}

/* --------------------------- reference numbers --------------------------- */

/** «REQ-2026-0001» — the shape, and the only shape, of a reference number. */
export const REQ_ID = /^REQ-(\d{4})-(\d{1,6})$/;

/** A reference number's comparison key: Latin digits, upper case, trimmed. */
export function reqIdKey(id: string | null | undefined): string {
  return latinDigits(String(id ?? "")).replace(/\s+/g, "").trim().toUpperCase();
}

/**
 * The next reference number for `year`.
 *
 * The append never returns the row it wrote, so this id is the ONLY way back
 * to a row — it is the customer's reference, the approval's `expect` value and
 * the replay key that stops an at-least-once retry booking the same request
 * twice. It is therefore computed on a FRESH read, and it is never a value the
 * tab already holds: the highest NNNN of the current year plus one, and then
 * the first free one from there (a gap in the sequence is left alone, and a
 * number typed by hand cannot be handed out again).
 */
export function nextReqId(existing: readonly (string | null | undefined)[], year: number): string {
  const taken = new Set<string>();
  let max = 0;
  for (const e of existing) {
    const k = reqIdKey(e);
    if (!k) continue;
    taken.add(k);
    const m = k.match(REQ_ID);
    if (m && Number(m[1]) === year) max = Math.max(max, Number(m[2]));
  }
  for (let n = max + 1; ; n++) {
    const id = `REQ-${year}-${String(n).padStart(4, "0")}`;
    if (!taken.has(id)) return id;
  }
}

/**
 * The hidden marker an approved request leaves in «أوامر العمل»!N «ملاحظات».
 *
 * It is what makes the two-step approval safe on an at-least-once bridge: if
 * the stamp on the request row fails after the work order landed, a second tap
 * re-reads the orders, finds the marker, skips creation and only re-stamps.
 */
export const jobMarker = (reqId: string): string => `[${reqIdKey(reqId)}]`;

/** The reference number inside a work order's notes, "" when there is none. */
export function reqIdFromNotes(notes: string | null | undefined): string {
  const m = latinDigits(String(notes ?? "")).toUpperCase().match(/\[(REQ-\d{4}-\d{1,6})\]/);
  return m ? m[1] : "";
}

/* -------------------------- quantities and units -------------------------- */

export const UNIT_PIECES = "قطعة";
export const UNIT_KG = "كجم";

/**
 * The piece weight in grams from «الرئيسي»'s free-text weight cell — the FIRST
 * number in it, the same rule lib/jobs.ts and the jobs pages use (that cell
 * held «21.6 ALL pieces» until 13 Sep 2026 and still holds «14جم للقطعه»).
 * 0 when the cell yields no number at all.
 */
export function pieceWeightG(weightCell: string | number | null | undefined): number {
  const m = String(weightCell ?? "").match(/[0-9]+(?:\.[0-9]+)?/);
  const n = m ? Number(m[0]) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * What the customer types in. Pieces when Master's weight is readable — that
 * is how a buyer thinks — and kilograms when it is not, because a piece count
 * with no weight behind it cannot be turned into anything the factory can buy
 * material against. Owner's decision 3.
 */
export const requestUnit = (weightCell: string | number | null | undefined): string =>
  pieceWeightG(weightCell) > 0 ? UNIT_PIECES : UNIT_KG;

/** One decimal place — the kilogram column's precision everywhere in the site. */
const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * The kilograms a request works out to: pieces × piece weight ÷ 1000, or the
 * number itself when it was already kilograms. The approval screen shows this
 * beside «العدد المطلوب» and can overwrite it — it is derived from a free-text
 * cell, and that screen is the last place a mis-parsed standard can be caught
 * before material is bought against it.
 */
export function qtyKgFor(qtyAsked: number, unit: string, grams: number): number {
  const q = Number(qtyAsked) || 0;
  if (q <= 0) return 0;
  if (unit === UNIT_PIECES && grams > 0) return round1((q * grams) / 1000);
  return round1(q);
}

/** Kilograms → pieces, or null when Master has no readable weight. Never a zero. */
export function piecesForKg(qtyKg: number, grams: number): number | null {
  if (!(grams > 0) || !(Number(qtyKg) > 0)) return null;
  return Math.round((Number(qtyKg) * 1000) / grams);
}

/* --------------------------------- caps ---------------------------------- */

/** Open requests one account may hold. Checked on the fresh read the submit
 *  already performs, so it cannot be dodged by hitting a different instance. */
export const MAX_OPEN_REQUESTS = 5;
/** Best-effort per-account limiter, the shape /api/contact uses for IPs. */
export const SUBMIT_WINDOW_MS = 60 * 60 * 1000;
export const MAX_SUBMITS_PER_WINDOW = 10;
/** How long a repeated submit still counts as the same one. */
export const REPLAY_WINDOW_MIN = 15;
/** Size caps, so nobody stores a novel in a sheet cell. */
export const NOTE_MAX = 500;
export const PRODUCT_MAX = 200;

/* -------------------------------- replay --------------------------------- */

/**
 * One of the caller's OWN rows, already shaped: the product folded through the
 * caller's name key (lib/master-lookup.ts `nameKey` — this module may import
 * nothing, so the fold is the caller's), the quantity as a number and the
 * dates already normalised.
 */
export type ReplayRow = {
  reqId: string;
  productKey: string;
  qtyAsked: number;
  unit: string;
  /** ISO yyyy-mm-dd. */
  wantedDate: string;
  /** «yyyy-mm-dd HH:MM» Cairo, as the tab holds it. */
  submittedAt: string;
};

/**
 * The reference number of a row that IS this submit, or "".
 *
 * The bridge is at-least-once — a write that answered failed may have landed —
 * and a phone on a factory wifi retries. Same customer, same product, same
 * number, same unit, same wanted date, within a quarter of an hour: that is a
 * retry, not a second order. Longer than that and it is a person deliberately
 * ordering the same thing again, which they are entitled to do.
 *
 * Rows are the CALLER'S OWN — the route filters by the client link before it
 * gets here, which is the same thing as matching on the client key and leaves
 * nothing for a mistake to reach across accounts.
 */
export function findReplay(
  own: readonly ReplayRow[],
  want: { productKey: string; qtyAsked: number; unit: string; wantedDate: string },
  nowStamp: string,
): string {
  const now = stampMinutes(nowStamp);
  if (now === null || !want.productKey) return "";
  for (const r of own) {
    if (r.productKey !== want.productKey) continue;
    if (r.qtyAsked !== want.qtyAsked) continue;
    if (r.unit !== want.unit) continue;
    if (r.wantedDate !== want.wantedDate) continue;
    const at = stampMinutes(r.submittedAt);
    if (at === null) continue;
    if (Math.abs(now - at) <= REPLAY_WINDOW_MIN) return r.reqId;
  }
  return "";
}

/* ------------------------------ whitelists ------------------------------- */
/**
 * What a customer is allowed to read back — a list, not an omission list.
 *
 * Everything else on those rows is the factory's: the machine and the last
 * machine, the mould number and code, material, masterbatch, piece weight,
 * cavities, cycle time, expected rates, possible defects, scrap and scrap
 * rate, downtime minutes and reason, the operator, the priority, the internal
 * notes, any other customer's anything — and the produced piece count and the
 * percentage, because production is credited to an order by product name alone
 * with no client term and no end date, so two open orders for one product each
 * receive the full total. A number that is sometimes wrong is worse than no
 * number on a screen the customer reads instead of phoning.
 *
 * tests/customer-requests.test.ts pins these two key sets EXACTLY, so a field
 * cannot ride along into the response on the back of a later change.
 */
export const PORTAL_REQUEST_KEYS = [
  "reqId", "submittedAt", "product", "qtyAsked", "unit", "qtyKg",
  "wantedDate", "note", "state", "rejectReason", "jobCode", "decidedAt",
] as const;

export type PortalRequest = {
  reqId: string;
  submittedAt: string;
  product: string;
  qtyAsked: number;
  unit: string;
  qtyKg: number;
  wantedDate: string;
  note: string;
  /** The INTERNAL token (pending/accepted/rejected/cancelled), or an unknown
   *  sheet word passed through — never the Arabic the tab stores. */
  state: string;
  rejectReason: string;
  jobCode: string;
  decidedAt: string;
};

/** Build the response object — explicitly, key by key, in the pinned order. */
export function portalRequest(src: {
  reqId?: string; submittedAt?: string; product?: string; qtyAsked?: number;
  unit?: string; qtyKg?: number; wantedDate?: string; note?: string;
  state?: string; rejectReason?: string; jobCode?: string; decidedAt?: string;
}): PortalRequest {
  return {
    reqId: src.reqId ?? "",
    submittedAt: src.submittedAt ?? "",
    product: src.product ?? "",
    qtyAsked: Number(src.qtyAsked) || 0,
    unit: src.unit ?? "",
    qtyKg: Number(src.qtyKg) || 0,
    wantedDate: src.wantedDate ?? "",
    note: src.note ?? "",
    state: src.state ?? "pending",
    rejectReason: src.rejectReason ?? "",
    jobCode: src.jobCode ?? "",
    decidedAt: src.decidedAt ?? "",
  };
}

export const PORTAL_ORDER_KEYS = [
  "code", "product", "qtyKg", "qtyPieces", "startDate", "dueDate", "status", "reqId",
] as const;

/** The three words a customer is shown. «متوقف» is NOT one of them. */
export type PortalOrderStatus = "not_started" | "in_production" | "completed";

export type PortalOrder = {
  code: string;
  product: string;
  qtyKg: number;
  /** null when «الرئيسي» yields no readable weight — never a zero. */
  qtyPieces: number | null;
  startDate: string;
  dueDate: string;
  status: PortalOrderStatus;
  /** The request this order came from, from the `[REQ-…]` marker; "" for an
   *  order the factory entered itself. */
  reqId: string;
};

/**
 * A work order's status as the customer sees it.
 *
 * «متوقف» (On Hold) reads as «جاري التشغيل». A stoppage is a machine problem,
 * not an order state, and telling a customer the press stopped invites the
 * question of which press — which is the factory's business. A status word
 * outside the four (a colleague types one) is not open ⇒ finished; open ⇒ not
 * started yet, which is the truthful reading of a row nobody has moved.
 */
export function portalOrderStatus(status: string, open: boolean): PortalOrderStatus {
  if (!open) return "completed";
  return status === "In Production" || status === "On Hold" ? "in_production" : "not_started";
}

export function portalOrder(src: {
  code?: string; product?: string; qtyKg?: number; qtyPieces?: number | null;
  startDate?: string; dueDate?: string; status: PortalOrderStatus; reqId?: string;
}): PortalOrder {
  return {
    code: src.code ?? "",
    product: src.product ?? "",
    qtyKg: Number(src.qtyKg) || 0,
    qtyPieces: src.qtyPieces ?? null,
    startDate: src.startDate ?? "",
    dueDate: src.dueDate ?? "",
    status: src.status,
    reqId: src.reqId ?? "",
  };
}

/* ------------------------------ the ladder ------------------------------- */

/**
 * The single line a card shows, as a token the page translates: the request's
 * own state until it is accepted, and the work order's state after that.
 * Merging them is what lets one card carry a request from «تم استلام طلبك» to
 * «اكتمل الإنتاج» without the customer being shown two things to reconcile.
 */
export type CardStep =
  | "submitted" | "rejected" | "cancelled"
  | "approved" | "running" | "done";

export function cardStep(state: string, order: { status: PortalOrderStatus } | null): CardStep {
  if (state === "rejected") return "rejected";
  if (state === "cancelled") return "cancelled";
  if (!order) return state === "accepted" ? "approved" : "submitted";
  if (order.status === "completed") return "done";
  if (order.status === "in_production") return "running";
  return "approved";
}
