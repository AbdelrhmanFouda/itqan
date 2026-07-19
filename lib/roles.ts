/**
 * Roles, access rules, and landing routes for the internal dashboard.
 * Phase 0 — sign-in + owner-approved role assignment.
 */

// The single bootstrap owner. This account is always granted the owner role
// (mirror this value in firestore.rules).
export const OWNER_EMAIL = "abdelrhman.2003.16@gmail.com";

export type Role = "owner" | "manager" | "production" | "quality" | "sales" | "finance" | "maintenance";
export type UserStatus = "pending" | "approved" | "rejected";

// Roles a new user can request (owner is the bootstrap account, never requestable).
// Order matters: the FIRST entry is the default when approving a request that has
// no stated role — keep a low-privilege role first and "manager" last so a stray
// approval never hands out full access by accident.
export const REQUESTABLE_ROLES: Role[] = ["production", "quality", "sales", "finance", "maintenance", "manager"];
export const ALL_ROLES: Role[] = ["owner", ...REQUESTABLE_ROLES];

// Roles that can see and do everything: the owner plus any manager.
export const FULL_ACCESS: Role[] = ["owner", "manager"];
export function hasFullAccess(role: Role): boolean {
  return FULL_ACCESS.includes(role);
}

export function isOwnerEmail(email: string | null | undefined): boolean {
  return (email ?? "").trim().toLowerCase() === OWNER_EMAIL.toLowerCase();
}

// Where each role lands after signing in.
export function landingFor(role: Role): string {
  switch (role) {
    case "finance": return "/dashboard/finance";
    case "sales": return "/dashboard/sales";
    case "maintenance": return "/dashboard/machines";
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
  | "hourly" | "issues" | "assistant" | "reports" | "clients" | "approvals";

// Production and Quality see EXACTLY the same things — keep them in one shared
// group so the two can never drift apart.
const OPS: Role[] = ["production", "quality"];

// Sidebar entries with the (non-full-access) roles allowed to see/visit them.
// owner + manager are handled by hasFullAccess() and always see every item.
export const NAV: { href: string; key: NavKey; roles: Role[] }[] = [
  { href: "/dashboard", key: "overview", roles: [...OPS] },
  { href: "/dashboard/finance", key: "finance", roles: ["finance"] },
  { href: "/dashboard/quality", key: "quality", roles: [...OPS] },
  { href: "/dashboard/sales", key: "sales", roles: ["sales"] },
  { href: "/dashboard/machines", key: "machines", roles: [...OPS, "maintenance"] },
  { href: "/dashboard/molds", key: "molds", roles: [...OPS] },
  { href: "/dashboard/products", key: "products", roles: [...OPS, "sales"] },
  { href: "/dashboard/jobs", key: "jobs", roles: [...OPS, "sales"] },
  { href: "/dashboard/production", key: "production", roles: [...OPS] },
  { href: "/dashboard/hourly", key: "hourly", roles: [...OPS] },
  { href: "/dashboard/issues", key: "issues", roles: [...OPS, "maintenance"] },
  { href: "/dashboard/performance", key: "performance", roles: [...OPS] },
  { href: "/dashboard/assistant", key: "assistant", roles: [...OPS] },
  { href: "/dashboard/reports", key: "reports", roles: [...OPS, "finance"] },
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
