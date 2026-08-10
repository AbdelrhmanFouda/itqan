"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Lang } from "@/lib/i18n";
import { isArabicOnlyPath } from "@/lib/arabic-only";

/**
 * Language, remembered.
 *
 * It used to start at "en" on every mount and never persist, so the site opened
 * in ENGLISH every single time. A worker who picked Arabic, logged a stoppage
 * and came back an hour later got English again — on a page used by people who
 * do not read English. The choice is now stored and restored.
 *
 * `LANG_STORAGE_KEY` and the inline script below must agree; the script runs
 * before React hydrates so the first paint is already in the right language and
 * direction, with no flash of English.
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

export function LangProvider({ children }: { children: ReactNode }) {
  // Initialised from storage during the very first client render, so the tree
  // never renders English and then swaps. On the server this is "en", which the
  // pre-hydration script in app/layout.tsx has already corrected in the DOM.
  const [stored, setStored] = useState<Lang>(() => storedLang() ?? "en");
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
