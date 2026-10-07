/**
 * The customer ACCOUNT KIND and the link that decides what it may see.
 *
 * A customer of the factory is not one of the nine staff roles — deliberately,
 * and permanently. `lib/roles.ts` is never extended with "customer": thirty
 * handlers call `requireRole(req)` with no allow-list, so a tenth role would
 * hand a buyer the whole order book, the storage log and `DELETE /api/jobs/[id]`
 * on the day it was approved. A customer's document lives in Firestore's
 * `customers/{uid}` instead, carries no role at all, and is therefore refused
 * by every one of those thirty handlers as a PROPERTY of the system rather than
 * as a check somebody has to remember to write.
 *
 * What this module owns is the LINK: the list of «العملاء» rows an account
 * speaks for, and the exact-match rule that decides whether a sheet row belongs
 * to it. That rule is a security boundary, not a search box:
 *
 *  - it is a LIST of spellings, because the live workbook does not agree with
 *    itself — «المصريه الذكيه للعدادات» on a work order is «المصرية الذكية» in
 *    «العملاء», «العربي لصناعه الأجهزة الكربائيه» is «توشيبا», and «ايداكو »
 *    carries a trailing space (measured 2026-09-22). The owner approves each
 *    alias by hand;
 *  - it folds ONLY what is safely foldable — Arabic-Indic digits, case,
 *    whitespace — and then compares whole strings. Never `foldWord` (the
 *    أ/ى/ة search fold would let «الهندي» reach «الهندية»), never a substring
 *    («رافال» would match «رافال للتجارة», a different row).
 *
 * Pure and import-free on purpose, like lib/work-orders.ts and lib/scrap.ts:
 * Node's test runner loads it directly, and the guard, the approvals screen and
 * the portal routes then share ONE reading of the rule. `clientKey` is a copy
 * of `nameKey` from lib/master-lookup.ts for that reason — the same trade that
 * module already makes with `moldKey` — and tests/portal-access.test.ts asserts
 * the two agree, value by value, on the spellings that matter.
 */

/** One «العملاء» row an account speaks for. `no` is column A, the stable id. */
export type ClientLink = { no: number; name: string; aliases: string[] };

export type CustomerStatus = "pending" | "approved" | "rejected";

/**
 * The `customers/{uid}` document.
 *
 * `clients` is ADMIN-ONLY: firestore.rules forbids the field outright on
 * create and allows update to an admin alone, so the account cannot link
 * itself. `requestedClient` is what the person typed at sign-up — display
 * only, and never used for access.
 */
export type CustomerAccount = {
  uid: string;
  email: string;
  displayName: string;
  kind: "customer";
  status: CustomerStatus;
  clients: ClientLink[];
  requestedClient: string;
  createdAt?: number;
  approvedBy?: string;
  approvedAt?: number;
};

const FILLER = new Set(["", "n/a", "na", "غير متاح", "غير متاح / n/a", "n/a / غير متاح", "-", "—", "–"]);

/**
 * The comparison key for a client name — identical to `nameKey` in
 * lib/master-lookup.ts. Arabic-Indic and Persian digits fold to Latin,
 * whitespace collapses, the ends are trimmed, case is folded, and the
 * workbook's deliberate «غير متاح / N/A» filler becomes "" so it can never
 * match anything.
 */
export function clientKey(name: string | null | undefined): string {
  const s = String(name ?? "")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/\s+/g, " ")
    .trim();
  const lower = s.toLowerCase();
  return FILLER.has(lower) ? "" : lower;
}

/**
 * «العملاء»!A «الرقم» as the number a link stores — 0 when the cell holds none.
 *
 * ONE reading, because two places build a link from a sheet row: the picker on
 * «حسابات العملاء» and the server when the owner makes a login himself
 * (app/api/customers), which must find the SAME row the picker sent.
 */
export function clientNoOf(cell: string | number | null | undefined): number {
  const n = Number(String(cell ?? "").replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Every key an account answers to: each link's canonical name and each of its
 * aliases. "" is excluded — a blank or filler cell must not become a key that
 * a blank row on the sheet then matches.
 */
export function clientKeysOf(clients: readonly ClientLink[] | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const c of clients ?? []) {
    for (const s of [c?.name, ...(c?.aliases ?? [])]) {
      const k = clientKey(s);
      if (k) out.add(k);
    }
  }
  return out;
}

/** Does a sheet row's client cell belong to this account? Exact key match only. */
export function belongsToCustomer(rowClient: string | null | undefined, keys: Set<string>): boolean {
  const k = clientKey(rowClient);
  return k !== "" && keys.has(k);
}

/**
 * A stored `clients` value, whatever shape it arrived in, as a clean list.
 *
 * Both readers of the document are untrusted-ish in different ways: the
 * Firestore REST decoder hands back plain objects assembled from `mapValue`
 * fields, and a document edited by hand in the console can hold anything. A
 * link with no usable name is dropped — it would contribute no key and only
 * make the approvals screen look linked when it is not.
 */
export function normalizeClients(raw: unknown): ClientLink[] {
  if (!Array.isArray(raw)) return [];
  const out: ClientLink[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const name = String(r.name ?? "").trim();
    if (!name) continue;
    const no = Number(r.no);
    const aliases = Array.isArray(r.aliases)
      ? Array.from(new Set(r.aliases.map((a) => String(a ?? "").trim()).filter(Boolean)))
      : [];
    out.push({ no: Number.isFinite(no) ? no : 0, name, aliases });
  }
  return out;
}

/**
 * A stored status as one of the three we know.
 *
 * Anything unrecognised — a missing field, a typo in the console, a future
 * word — reads as "pending", never as "approved". A status is the thing that
 * opens the portal; an unknown one must fail closed.
 */
export function customerStatusOf(raw: unknown): CustomerStatus {
  return raw === "approved" || raw === "rejected" ? raw : "pending";
}

/** Approved AND linked — the two conditions for seeing any factory data. */
export function isLinkedCustomer(
  account: { status: CustomerStatus; clients: readonly ClientLink[] } | null | undefined,
): boolean {
  return !!account && account.status === "approved" && account.clients.length > 0;
}
