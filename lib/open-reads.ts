/**
 * The ONLY /api/sheet/[entity] entities served without a token — the
 * documented deliberately-open operational reads. Every other entity that
 * route can serve is DENY-BY-DEFAULT (any approved role), and this set is the
 * deny list's one exception.
 *
 * ── Why deny-by-default exists ───────────────────────────────────────────────
 * The route used to open EVERY key in ENTITIES unless someone remembered to
 * add a guard line for it, and on 2026-08-28 the review pass found what that
 * shape costs: `sheet/jobs` served the full order book (client names +
 * ordered quantities) right past the guard on /api/jobs, `sheet/production`
 * served the client name on every production row (a column the curated
 * /api/runs deliberately omits), and `sheet/master` was open too. Inverted,
 * a NEW entity added to ENTITIES is guarded until it is consciously added
 * here — an omission fails closed instead of leaking.
 *
 * Changing this set is therefore a decision to PUBLISH or UNPUBLISH factory
 * data, not housekeeping. tests/open-reads.test.ts pins the exact contents so
 * that decision cannot happen as a side effect of something else.
 *
 * This module has ZERO imports so Node's test runner can load it directly —
 * the same trade lib/run-join.ts and lib/scrap.ts make.
 *
 * ── 2026-09-23: all four closed, and the set is now EMPTY ───────────────────
 * `products` and `molds` each answered 200 with 532 rows to a caller with no
 * token — 503 product names, 502 of them paired with a REAL CLIENT NAME, 64
 * clients. `machines` published the registry and, with it, the machine count
 * the owner's rule of 2026-09-20 forbids anywhere public. The customer portal
 * promises a buyer sees only their own products; leaving those URLs open would
 * have made that promise theatre.
 *
 * `issues` was kept for a few hours on the reasoning that a fault row «names a
 * machine and a symptom and no customer». The review pass read the entity
 * definition instead of the sentence: ENTITIES.issues declares `product` and
 * `machine`, so «الأعطال» served real product names and registry labels
 * («PQ 7 — 100») — the machine count included — to anyone. It is guarded too,
 * and `GET /api/issues` with it, so the set is empty and every entity this
 * route can serve now needs a token. An empty deny-list exception is the right
 * resting state: adding to it is a decision to PUBLISH factory data.
 *
 * The pages that read them (the issues page and its product datalist, the
 * moulds and products sections) go through lib/authed-fetch.ts instead;
 * nothing on the public site reads any of them.
 */
export const OPEN_READS = new Set<string>([]);

/**
 * Entities the generic read serves to SALES (+ owner/manager) alone — stricter
 * than the deny-by-default guard, which admits any approved role.
 *
 * «العملاء» has been here since the guard existed: contact details. «طلبات
 * العملاء» joined on 2026-09-23, on the review pass that noticed the generic
 * door was wider than the dedicated one. `/api/requests` is
 * `requireRole(req, ["sales"])` because a request row names a customer and one
 * tap on it creates a work order with material against it — and
 * tests/views-matrix.test.ts keeps /dashboard/requests to owner, manager and
 * sales. Registering the tab in ENTITIES made `/api/sheet/customerRequests`
 * serve those same rows — customer name, client number, product, quantity, the
 * buyer's note, the reject reason, who decided — to a `worker`, `production`,
 * `quality` or `storage` token. One list, both doors.
 *
 * Pinned by tests/open-reads.test.ts.
 */
export const SALES_ONLY = new Set(["clients", "customerRequests"]);

/**
 * The ONLY entities /api/sheet/[entity]'s generic PATCH may write — the two
 * tabs components/dashboard/SheetSection.tsx actually edits. Everything else
 * is DENY-BY-DEFAULT for the same reason the reads are: that PATCH accepted
 * all nine ENTITIES keys, so a generic row write could reach «الإنتاج»,
 * «أوامر العمل» or Master past the dedicated routes that verify identity,
 * diff the changes and refuse a duplicated product name.
 *
 * The real writes live on those routes (/api/molds, /api/jobs/[id],
 * /api/issues/[row], /api/runs, /api/machines), so nothing here removes a
 * working feature. The check runs AFTER requireRole, so an anonymous PATCH
 * still answers 401, never 403.
 *
 * Pinned by tests/open-reads.test.ts.
 */
export const WRITABLE_ENTITIES = new Set(["products", "clients"]);

/**
 * Fields the generic PATCH may NOT write, per entity — a second, narrower
 * deny list inside the writable set.
 *
 * «العملاء»!A «الرقم» joined the site's clients entity on 2026-09-23 because
 * the customer portal stores it on a `customers/{uid}` document as the stable
 * half of that account's link. From that moment it stopped being a label and
 * became an access key: renumbering a row by hand through the generic sheet
 * editor would quietly point an approved buyer's account at a different
 * company's row. Nothing in the site needs to write it, so nothing may.
 *
 * The route strips these keys rather than refusing the whole PATCH — the other
 * fields in the same save are ordinary contact data and there is no reason to
 * lose them. SheetSection renders them as plain text for the same reason: an
 * input that silently does not save is worse than no input.
 *
 * Pinned by tests/open-reads.test.ts.
 */
export const READONLY_FIELDS: Record<string, Set<string>> = {
  clients: new Set(["no"]),
};

/** The read-only field keys of an entity (empty when it has none). */
export function readonlyFields(entity: string): Set<string> {
  return READONLY_FIELDS[entity] ?? new Set<string>();
}
