/**
 * Roles, access rules, and landing routes for the internal dashboard.
 * Phase 0 — sign-in + owner-approved role assignment.
 */

// The single bootstrap owner. This account is always granted the owner role
// (mirror this value in firestore.rules).
const OWNER_EMAIL = "abdelrhman.2003.16@gmail.com";

export type Role =
  | "owner" | "manager" | "worker" | "production" | "quality"
  | "sales" | "finance" | "maintenance" | "storage";
export type UserStatus = "pending" | "approved" | "rejected";

// Roles a new user can request (owner is the bootstrap account, never requestable).
// Order matters: the FIRST entry is the default when approving a request that has
// no stated role — keep a low-privilege role first and "manager" last so a stray
// approval never hands out full access by accident. "worker" is now the least
// privileged, so it takes that first slot (it used to be "production", which can
// see far more).
export const REQUESTABLE_ROLES: Role[] = [
  "worker", "production", "quality", "sales", "finance", "maintenance", "storage", "manager",
];
export const ALL_ROLES: Role[] = ["owner", ...REQUESTABLE_ROLES];

/**
 * The ONLY way an untrusted string becomes a `Role`.
 *
 * A granted role arrives from Firestore as free text and used to be cast
 * straight to `Role` (`d.role as Role`), so a profile hand-written with any
 * word at all — `status: "approved", role: "customer"` — passed every bare
 * `requireRole(req)` in the site. Nothing in the type system catches that: the
 * cast is a promise, not a check. Validate here, in the one zero-import module
 * that owns the list, and an unknown word resolves to null → 401 everywhere.
 *
 * Pinned by tests/role-hardening.test.ts.
 */
export function asRole(value: unknown): Role | null {
  return typeof value === "string" && (ALL_ROLES as string[]).includes(value)
    ? (value as Role)
    : null;
}

// Roles that can see and do everything: the owner plus any manager.
const FULL_ACCESS: Role[] = ["owner", "manager"];
export function hasFullAccess(role: Role): boolean {
  return FULL_ACCESS.includes(role);
}

export function isOwnerEmail(email: string | null | undefined): boolean {
  return (email ?? "").trim().toLowerCase() === OWNER_EMAIL.toLowerCase();
}

/**
 * Where each role lands after signing in.
 *
 * ⚠ Every branch here MUST be a page that role can actually reach, or the user
 * signs in straight into a screen the layout bounces them off. That invariant —
 * `canAccess(role, landingFor(role))` for every role in ALL_ROLES — is asserted
 * in tests/roles.test.ts. Change NAV and this function together.
 *
 * A worker has no overview, so "/dashboard" would be a forbidden landing for
 * them; downtime is their whole job, so that is where they start.
 */
export function landingFor(role: Role): string {
  switch (role) {
    case "finance": return "/dashboard/finance";
    case "sales": return "/dashboard/sales";
    case "maintenance": return "/dashboard/machines";
    case "storage": return "/dashboard/storage";
    case "worker": return "/dashboard/downtime";
    case "quality":
    case "production":
    case "manager":
    case "owner":
    default: return "/dashboard";
  }
}

export type NavKey =
  | "overview" | "finance" | "quality" | "sales"
  | "machines" | "molds" | "products" | "jobs" | "requests" | "production" | "performance"
  | "downtime" | "issues" | "assistant" | "reports" | "clients" | "approvals" | "storage" | "stock" | "changeover";

/**
 * Sidebar entries with the (non-full-access) roles allowed to see/visit them.
 * owner + manager are handled by hasFullAccess() and always see every item.
 *
 * Production and Quality used to share one `OPS` constant, on the rule that they
 * must see exactly the same things. That is deliberately over — they now differ,
 * so every entry lists its roles explicitly and there is no shared alias to
 * reintroduce the coupling by accident.
 *
 * ⚠ This table is UX gating: it decides what a role SEES and can navigate to.
 * It is not a security boundary. Some operational read APIs stay deliberately
 * open; the exhaustive list is DOCUMENTED_OPEN in tests/api-guards.test.ts
 * (with lib/open-reads.ts for /api/sheet/[entity]) — never repeated here,
 * because a second copy of it is a copy that drifts.
 * Removing a page from a role hides it; it does not classify the data.
 */
export const NAV: { href: string; key: NavKey; roles: Role[] }[] = [
  { href: "/dashboard", key: "overview", roles: ["production", "quality"] },
  { href: "/dashboard/finance", key: "finance", roles: ["finance"] },
  { href: "/dashboard/quality", key: "quality", roles: ["quality"] },
  { href: "/dashboard/sales", key: "sales", roles: ["sales"] },
  { href: "/dashboard/machines", key: "machines", roles: ["maintenance"] },
  // The mould register is the floor's too: a worker at the press needs the
  // mould number for the product in front of them, and may correct the row
  // (owner's word, 2026-09-04: "allow for editing for everyone"). This entry
  // only decides who can OPEN the page; /api/molds guards the write.
  { href: "/dashboard/molds", key: "molds", roles: ["worker"] },
  { href: "/dashboard/products", key: "products", roles: ["sales", "storage"] },
  { href: "/dashboard/jobs", key: "jobs", roles: ["production", "sales", "storage"] },
  // «طلبات العملاء» — the customer portal's review queue (2026-09-23, owner's
  // decision 6: sales, manager and the owner approve). NOT production and NOT
  // quality: a row here names a customer and turns into a real work order with
  // material bought against it. Without an entry of its own the page would be
  // inherited through the overview prefix by exactly those two roles.
  { href: "/dashboard/requests", key: "requests", roles: ["sales"] },
  // «المتاح في المخزن» (2026-09-09 brief): the production side reads the
  // warehouse to answer «can I promise this?» — المتوفر, المحجوز on open work
  // orders, المتاح — and writes NOTHING there. Not the storekeeper's page
  // (`storage`, which records movements); the two are deliberately separate
  // so a production account never holds a warehouse write button.
  // The storekeeper reads stock, jobs, products and the assistant too (owner,
  // 2026-10-05) — beside the storage page, not instead of it.
  { href: "/dashboard/stock", key: "stock", roles: ["production", "storage"] },
  // «خطة الاسطمبات» (2026-09-30): which mould goes on which machine next.
  // The production engineer's page — it names clients and orders and one tap
  // on it rewrites a work order's machine, so NOT the floor's `worker` role
  // and not quality. An entry of its own, or the overview prefix would hand
  // it to quality as well.
  { href: "/dashboard/changeover", key: "changeover", roles: ["production"] },
  { href: "/dashboard/production", key: "production", roles: ["production"] },
  // Downtime capture is the shop floor's own surface: the worker who stops the
  // machine, the supervisor who runs it, and maintenance who fix it.
  { href: "/dashboard/downtime", key: "downtime", roles: ["production", "worker", "maintenance"] },
  { href: "/dashboard/storage", key: "storage", roles: ["storage"] },
  { href: "/dashboard/issues", key: "issues", roles: ["production", "quality", "worker", "maintenance"] },
  { href: "/dashboard/performance", key: "performance", roles: ["production", "quality"] },
  { href: "/dashboard/assistant", key: "assistant", roles: ["production", "quality", "worker", "storage"] },
  { href: "/dashboard/reports", key: "reports", roles: ["finance"] },
  { href: "/dashboard/clients", key: "clients", roles: ["sales"] },
  { href: "/dashboard/approvals", key: "approvals", roles: [] }, // owner + manager only
];

// Nav items visible to a given role, in display order.
export function navFor(role: Role) {
  if (hasFullAccess(role)) return NAV;
  return NAV.filter((n) => n.roles.includes(role));
}

// Whether a role may view a given dashboard pathname (longest-prefix match).
export function canAccess(role: Role, pathname: string): boolean {
  if (hasFullAccess(role)) return true;
  const match = NAV
    .filter((n) => pathname === n.href || pathname.startsWith(n.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0];
  if (!match) return false; // unknown dashboard route → owner/manager only
  return match.roles.includes(role);
}
