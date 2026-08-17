"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Lang } from "@/lib/i18n";
import { isArabicOnlyPath } from "@/lib/arabic-only";
import { writeLangCookie } from "@/lib/lang-cookie";

/**
 * Language, remembered.
 *
 * It used to start at "en" on every mount and never persist, so the site opened
 * in ENGLISH every single time. A worker who picked Arabic, logged a stoppage
 * and came back an hour later got English again — on a page used by people who
 * do not read English. The choice is now stored and restored.
 *
 * ── And storing it was still not enough (2026-08-17) ──────────────────────
 * localStorage cannot be read while the server builds the HTML, so the server
 * kept sending English TEXT and the browser only corrected it after hydrating.
 * The choice survived; the first paint did not. It is now also written to a
 * COOKIE, which the root layout reads to render the right language in the first
 * byte — see lib/lang-cookie.ts. `initial` is that server-known value.
 *
 * `LANG_STORAGE_KEY`, the cookie, and the inline script in app/layout.tsx must
 * all agree.
 */
export const LANG_STORAGE_KEY = "itqan.lang";

const isLang = (v: unknown): v is Lang => v === "ar" || v === "en";

/** Read the stored choice. Safe on the server, where there is no window. */
export function storedLang(): Lang | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(LANG_STORAGE_KEY);
    return isLang(v) ? v : null;
  } catch {
    return null; // private mode / storage disabled
  }
}

const LangContext = createContext<{
  lang: Lang;
  setLang: (l: Lang) => void;
}>({ lang: "en", setLang: () => {} });

export function LangProvider({
  children,
  initial,
}: {
  children: ReactNode;
  /** What the SERVER already rendered, from the cookie. */
  initial?: Lang;
}) {
  // On the server, `storedLang()` is null and this is the cookie's value — so
  // the HTML is generated in the right language. On the client, localStorage
  // wins if it holds something, which is what carries a choice made before the
  // cookie existed. Once both agree (one navigation later) there is no
  // mismatch between the two renders at all.
  const [stored, setStored] = useState<Lang>(() => storedLang() ?? initial ?? "en");
  const pathname = usePathname();
  const forcedArabic = isArabicOnlyPath(pathname);
  const lang: Lang = forcedArabic ? "ar" : stored;

  const setLang = (l: Lang) => {
    setStored(l);
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, l);
    } catch {
      /* storage unavailable — the choice still applies for this session */
    }
  };

  // Mirror the CHOICE into the cookie — `stored`, never `lang`. On
  // /dashboard/downtime `lang` is forced to Arabic for everyone, and writing
  // that would silently convert an English-reading manager's own preference
  // just because he opened the capture page once.
  //
  // Runs on every change AND on mount, which is what migrates anyone whose
  // choice predates the cookie: their next page load is server-rendered
  // correctly without them touching anything.
  useEffect(() => {
    writeLangCookie(stored);
  }, [stored]);

  // Keep <html lang/dir> in step with the choice, for screen readers and for
  // any CSS or browser behaviour that keys off the document direction.
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  return <LangContext.Provider value={{ lang, setLang }}>{children}</LangContext.Provider>;
}

export function useLang() {
  return useContext(LangContext);
}
