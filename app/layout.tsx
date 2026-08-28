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
  const lang = langFromValue((await cookies()).get(LANG_COOKIE)?.value) ?? "en";
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
 * Two jobs, and neither replaces the other.
 *
 *  1. MIGRATE a choice that predates the cookie. Anyone who picked Arabic
 *     before 2026-08-17 has it in localStorage only, which the server cannot
 *     read, so their first load after this deploy would still be English.
 *     Copying it into the cookie here means the NEXT request is right, without
 *     them touching anything.
 *  2. FORCE Arabic on /dashboard/downtime, which is used by people who do not
 *     read English. That must not depend on a stored preference, on a cookie,
 *     or on finding a toggle — and it deliberately does NOT write the cookie,
 *     so visiting the capture page never rewrites anyone's own preference.
 *
 * It still corrects `<html lang/dir>` too, which matters for the one render
 * where the cookie is missing and localStorage is not.
 * Kept in sync with LANG_STORAGE_KEY and lib/lang-cookie.ts.
 */
const LANG_BOOTSTRAP = `(function(){try{
var f=location.pathname.indexOf("/dashboard/downtime")===0;
var m=document.cookie.match(/(?:^|;\\s*)itqan\\.lang=(ar|en)(?:;|$)/);
var c=m?m[1]:null;
var s=localStorage.getItem("itqan.lang");
if(s!=="ar"&&s!=="en")s=null;
if(!c&&s){document.cookie="itqan.lang="+s+"; path=/; max-age=31536000; SameSite=Lax";c=s;}
var l=f?"ar":(s||c||"en");
document.documentElement.lang=l;
document.documentElement.dir=l==="ar"?"rtl":"ltr";
}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The whole point: read the choice while the HTML is being built, so the
  // first byte is already in the right language instead of being corrected a
  // second later. Costs static prerendering of the shell — see CLAUDE.md.
  // `.get()` returns {name, value}, so this is a bare "ar" — langFromValue, not
  // the header parser. Getting that wrong renders the whole site in English
  // with every test still green.
  const lang = langFromValue((await cookies()).get(LANG_COOKIE)?.value) ?? "en";
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
