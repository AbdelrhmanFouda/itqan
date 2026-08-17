import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist } from "next/font/google";
import "./globals.css";
import { LangProvider } from "@/context/LangContext";
import { AuthProvider } from "@/context/AuthContext";
import { LANG_COOKIE, langFromValue } from "@/lib/lang-cookie";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Itqan — Industrial Manufacturing",
  description:
    "Plastic injection molding, fan counterweights, and CNC mold manufacturing in Egypt.",
};

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
