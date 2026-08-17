/**
 * The language choice, in a cookie, so the SERVER can honour it.
 *
 * ── Why a cookie when localStorage already worked ─────────────────────────
 * It did work — and the site still opened in English every time. localStorage
 * cannot be read while the HTML is being generated, so the server had no way
 * to know the choice and always rendered English. Measured against production
 * on 2026-08-17: `curl https://itqan-taupe.vercel.app/` returned
 * `<html lang="en">` with 14 English words and 0 Arabic, whatever was stored.
 *
 * The inline script in app/layout.tsx fixed `<html lang>` and `dir` before the
 * first paint, so the LAYOUT was right — but the TEXT is baked into the HTML by
 * React and only becomes Arabic once the bundle has downloaded, parsed and
 * hydrated. On a phone on factory wifi that is a long, visible window of
 * English, and it reads exactly like the site forgetting the choice.
 *
 * A cookie rides along with the request, so the very first byte is Arabic.
 *
 * localStorage is KEPT, not replaced: it is what the pre-hydration script reads
 * for anyone who chose Arabic before this shipped, and it is the fallback when
 * cookies are blocked. The two are written together and the cookie is the one
 * the server trusts.
 *
 * Zero imports so Node's test runner can load it directly.
 */

export type LangValue = "ar" | "en";

/** Same name as the localStorage key — one concept, one name. */
export const LANG_COOKIE = "itqan.lang";

/** A year. The choice is a preference, not a session. */
export const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const isLangValue = (v: unknown): v is LangValue => v === "ar" || v === "en";

/**
 * The language from an ALREADY-EXTRACTED cookie value.
 *
 * This is the server's entry point, and it is a different shape from
 * `parseLangCookie`: Next's `cookies().get(name)` hands back `{name, value}`,
 * so what arrives here is a bare `"ar"`, not `"itqan.lang=ar"`. Passing that to
 * the header parser silently yields null and the whole site renders in English
 * while every unit test still passes — which is exactly what happened on the
 * first attempt at this, on 2026-08-17.
 */
export const langFromValue = (v: string | null | undefined): LangValue | null =>
  isLangValue(v) ? v : null;

/**
 * Pull the language out of a raw `Cookie:` header, or out of `document.cookie`.
 *
 * Matches only a whole cookie name — a stray `my.itqan.lang=en` must not be
 * mistaken for ours — and ignores any value that is not one of the two known
 * languages, so a corrupted or hand-edited cookie falls back rather than
 * rendering a page in nothing.
 */
export function parseLangCookie(header: string | null | undefined): LangValue | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== LANG_COOKIE) continue;
    const v = part.slice(eq + 1).trim();
    if (isLangValue(v)) return v;
  }
  return null;
}

/**
 * The `document.cookie` string that stores a choice.
 *
 * `SameSite=Lax` because this is a preference, not a credential, and it must
 * survive an ordinary top-level navigation into the site. No `Secure` flag:
 * the dev server is plain http and a cookie the developer's browser refuses to
 * set is a bug that only shows up locally.
 */
export function langCookieString(lang: LangValue, path = "/"): string {
  return `${LANG_COOKIE}=${lang}; path=${path}; max-age=${LANG_COOKIE_MAX_AGE}; SameSite=Lax`;
}

/** Write the choice where the server will see it on the next request. */
export function writeLangCookie(lang: LangValue): void {
  if (typeof document === "undefined") return;
  try {
    document.cookie = langCookieString(lang);
  } catch {
    /* cookies disabled — localStorage still carries the choice for this browser */
  }
}
