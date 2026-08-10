/**
 * Routes that are ALWAYS Arabic, whatever is stored and whoever is signed in.
 *
 * Pure and import-free so it can be unit-tested, and so the same rule is used by
 * context/LangContext.tsx (render) and app/dashboard/layout.tsx (hiding the
 * language toggle). The inline pre-hydration script in app/layout.tsx repeats
 * this check in plain JS — keep the two in step.
 *
 * /dashboard/downtime is on this list because it is used by workers who do not
 * read English. Arabic there must not depend on a stored preference or on
 * finding a toggle.
 */
export const ARABIC_ONLY = ["/dashboard/downtime"];

export function isArabicOnlyPath(p: string | null | undefined): boolean {
  return !!p && ARABIC_ONLY.some((r) => p === r || p.startsWith(`${r}/`));
}
