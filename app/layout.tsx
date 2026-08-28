import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist } from "next/font/google";
import "./globals.css";
import { LangProvider } from "@/context/LangContext";
import { AuthProvider } from "@/context/AuthContext";
import { LANG_COOKIE, langFromValue } from "@/lib/lang-cookie";

const geist = Geist({ subsets: ["latin"] });

// Bilingual, server-rendered metadata. The language cookie is readable here —
// RootLayout below already reads it for <html lang/dir> — so the title and
// description arrive in the visitor's own language in the first byte, same
// rule as the page text itself.
const META = {
  en: {
    title: "Itqan — Industrial Manufacturing",
    description:
      "Plastic injection molding, fan counterweights, and CNC mold manufacturing in Egypt.",
    ogTitle: "Itqan إتقان — Plastic Injection Molding & CNC Mold Making",
    ogDescription:
      "Plastic injection molding, fan counterweights and CNC mold making in Egypt — مصنع مصري لحقن البلاستيك وأثقال المراوح وتصنيع الاسطمبات CNC.",
    locale: "en_US",
  },
  ar: {
    title: "إتقان — حقن بلاستيك وتصنيع اسطمبات",
    description:
      "مصنع مصري لحقن البلاستيك وأثقال المراوح وتصنيع الاسطمبات CNC.",
    ogTitle: "إتقان Itqan — حقن بلاستيك وتصنيع اسطمبات",
    ogDescription:
      "مصنع مصري لحقن البلاستيك وأثقال المراوح وتصنيع الاسطمبات CNC — Plastic injection molding, fan counterweights and CNC mold making in Egypt.",
    locale: "ar_EG",
  },
} as const;

export async function generateMetadata(): Promise<Metadata> {
  // No stored choice → ARABIC (owner's word, 2026-08-28) — the company
  // language. Same fallback in RootLayout, LangContext and the bootstrap.
  const lang = langFromValue((await cookies()).get(LANG_COOKIE)?.value) ?? "ar";
  const m = META[lang];
  return {
    metadataBase: new URL("https://itqan-taupe.vercel.app"),
    // The template composes per-page titles ("العملاء — إتقان Itqan") for the
    // few SERVER pages (clients/molds/products export a plain-string title).
    // Client pages cannot export metadata at all — they set document.title via
    // components/dashboard/use-page-title.ts, which composes the SAME suffix
    // by hand. Change one, change both.
    title: { default: m.title, template: "%s — إتقان Itqan" },
    description: m.description,
    // WhatsApp is the distribution channel here — without these a shared link
    // renders with no preview card at all. The image comes from
    // app/opengraph-image.tsx (generated, brand-true, no stock photos).
    openGraph: {
      title: m.ogTitle,
      description: m.ogDescription,
      url: "/",
      siteName: "Itqan إتقان",
      type: "website",
      locale: m.locale,
    },
    twitter: { card: "summary_large_image" },
  };
}

/**
 * One job: MIGRATE a choice that predates the cookie. Anyone who picked a
 * language before 2026-08-17 has it in localStorage only, which the server
 * cannot read, so their first load after that deploy would still miss it.
 * Copying it into the cookie here means the NEXT request is right, without
 * them touching anything.
 *
 * It still corrects `<html lang/dir>` too, which matters for the one render
 * where the cookie is missing and localStorage is not. The no-choice fallback
 * is ARABIC — owner's word, 2026-08-28 — matching RootLayout and LangContext.
 * (The script used to also FORCE Arabic on /dashboard/downtime; that forcing
 * was removed the same day, at the owner's word — see lib/arabic-only.ts.)
 * Kept in sync with LANG_STORAGE_KEY and lib/lang-cookie.ts.
 */
const LANG_BOOTSTRAP = `(function(){try{
var m=document.cookie.match(/(?:^|;\\s*)itqan\\.lang=(ar|en)(?:;|$)/);
var c=m?m[1]:null;
var s=localStorage.getItem("itqan.lang");
if(s!=="ar"&&s!=="en")s=null;
if(!c&&s){document.cookie="itqan.lang="+s+"; path=/; max-age=31536000; SameSite=Lax";c=s;}
var l=s||c||"ar";
document.documentElement.lang=l;
document.documentElement.dir=l==="ar"?"rtl":"ltr";
}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The whole point: read the choice while the HTML is being built, so the
  // first byte is already in the right language instead of being corrected a
  // second later. Costs static prerendering of the shell — see CLAUDE.md.
  // `.get()` returns {name, value}, so this is a bare "ar" — langFromValue, not
  // the header parser. Getting that wrong renders the whole site in the
  // fallback language with every test still green.
  const lang = langFromValue((await cookies()).get(LANG_COOKIE)?.value) ?? "ar";
  const dir = lang === "ar" ? "rtl" : "ltr";
  return (
    <html lang={lang} dir={dir}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: LANG_BOOTSTRAP }} />
      </head>
      <body className={`${geist.className} bg-white text-gray-900 antialiased`}>
        <LangProvider initial={lang}>
          <AuthProvider>{children}</AuthProvider>
        </LangProvider>
      </body>
    </html>
  );
}
