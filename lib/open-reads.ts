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
 */
export const OPEN_READS = new Set(["molds", "products", "machines", "issues"]);
