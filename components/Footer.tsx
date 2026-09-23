"use client";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import Link from "next/link";
import ContactDetails from "@/components/ContactDetails";

export default function Footer() {
  const { lang } = useLang();
  const tr = t[lang];
  const isAr = lang === "ar";

  return (
    <footer dir={isAr ? "rtl" : "ltr"} className="bg-gray-950 border-t border-white/5 py-10">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-xs">إ</div>
          <span className="text-sm font-semibold text-white">Itqan · إتقان</span>
        </div>
        <ContactDetails variant="footer" />
        <div className="mt-8 pt-6 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p className="text-xs text-gray-600 text-center">
            © {new Date().getFullYear()} Itqan · إتقان · {tr.footer.location} · {tr.footer.rights}
          </p>
          <div className="flex items-center gap-4">
            <Link href="/portal/login" className="text-xs text-gray-600 hover:text-blue-400 transition-colors py-2.5 min-h-11 inline-flex items-center">
              {tr.nav.customerLogin} {isAr ? "←" : "→"}
            </Link>
            <Link href="/dashboard" className="text-xs text-gray-600 hover:text-blue-400 transition-colors py-2.5 min-h-11 inline-flex items-center">
              {tr.nav.dashboard} {isAr ? "←" : "→"}
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
