import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { LangProvider } from "@/context/LangContext";
import { AuthProvider } from "@/context/AuthContext";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Itqan — Industrial Manufacturing",
  description:
    "Plastic injection molding, fan counterweights, and CNC mold manufacturing in Egypt.",
};

/**
 * Applies the remembered language to <html> BEFORE React hydrates, so a worker
 * who chose Arabic never sees a flash of English first. The /dashboard/downtime
 * path is forced to Arabic outright — it is used by people who do not read
 * English, so Arabic must not depend on a stored preference or on finding a
 * toggle. Kept in sync with LANG_STORAGE_KEY in context/LangContext.tsx.
 */
const LANG_BOOTSTRAP = `(function(){try{
var f=location.pathname.indexOf("/dashboard/downtime")===0;
var l=f?"ar":(localStorage.getItem("itqan.lang")||"en");
if(l!=="ar"&&l!=="en")l="en";
document.documentElement.lang=l;
document.documentElement.dir=l==="ar"?"rtl":"ltr";
}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: LANG_BOOTSTRAP }} />
      </head>
      <body className={`${geist.className} bg-white text-gray-900 antialiased`}>
        <LangProvider>
          <AuthProvider>{children}</AuthProvider>
        </LangProvider>
      </body>
    </html>
  );
}
