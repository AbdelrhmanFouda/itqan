/**
 * Routes that are ALWAYS Arabic, whatever is stored and whoever is signed in.
 *
 * Pure and import-free so it can be unit-tested, and so the same rule is used by
 * context/LangContext.tsx (render) and app/dashboard/layout.tsx (hiding the
 * language toggle).
 *
 * THE LIST IS EMPTY — deliberately, at the owner's word (2026-08-28).
 * /dashboard/downtime was on it from 2026-08-17 because the capture page is
 * used by workers who do not read English. But forcing it meant the OWNER was
 * forcibly switched to Arabic (toggle hidden) every time he opened the tab,
 * and he asked for that to stop. The worker protection moved to the DEFAULT:
 * the whole site now defaults to Arabic when no choice is stored, so a worker
 * who never touches the toggle sees Arabic everywhere — no forcing needed.
 * The mechanism stays so a route can be re-added with one line if ever wanted.
 */
export const ARABIC_ONLY: string[] = [];

export function isArabicOnlyPath(p: string | null | undefined): boolean {
  return !!p && ARABIC_ONLY.some((r) => p === r || p.startsWith(`${r}/`));
}
