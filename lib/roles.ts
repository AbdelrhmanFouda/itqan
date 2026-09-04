/**
 * Roles, access rules, and landing routes for the internal dashboard.
 * Phase 0 — sign-in + owner-approved role assignment.
 */

// The single bootstrap owner. This account is always granted the owner role
// (mirror this value in firestore.rules).
export const OWNER_EMAIL = "abdelrhman.2003.16@gmail.com";

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

// Roles that can see and do everything: the owner plus any manager.
export const FULL_ACCESS: Role[] = ["owner", "manager"];
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
  | "machines" | "molds" | "products" | "jobs" | "production" | "performance"
  | "downtime" | "issues" | "assistant" | "reports" | "clients" | "approvals" | "storage";

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
 * It is not a security boundary. The operational read APIs (molds, products,
 * machines, runs, oee, issues) stay deliberately open — see CLAUDE.md.
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
  { href: "/dashboard/products", key: "products", roles: ["sales"] },
  { href: "/dashboard/jobs", key: "jobs", roles: ["production", "sales"] },
  { href: "/dashboard/production", key: "production", roles: ["production"] },
  // Downtime capture is the shop floor's own surface: the worker who stops the
  // machine, the supervisor who runs it, and maintenance who fix it.
  { href: "/dashboard/downtime", key: "downtime", roles: ["production", "worker", "maintenance"] },
  { href: "/dashboard/storage", key: "storage", roles: ["storage"] },
  { href: "/dashboard/issues", key: "issues", roles: ["production", "quality", "worker", "maintenance"] },
  { href: "/dashboard/performance", key: "performance", roles: ["production", "quality"] },
  { href: "/dashboard/assistant", key: "assistant", roles: ["production", "quality", "worker"] },
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
