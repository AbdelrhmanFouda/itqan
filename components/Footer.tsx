"use client";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import Link from "next/link";

export default function Footer() {
  const { lang } = useLang();
  const tr = t[lang];
  const isAr = lang === "ar";

  return (
    <footer dir={isAr ? "rtl" : "ltr"} className="bg-gray-950 border-t border-white/5 py-10">
      <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-xs">إ</div>
          <span className="text-sm font-semibold text-white">Itqan إتقان</span>
        </div>
        <p className="text-xs text-gray-600 text-center">
          © {new Date().getFullYear()} Itqan · {tr.footer.location} · {tr.footer.rights}
        </p>
        <Link href="/dashboard" className="text-xs text-gray-600 hover:text-blue-400 transition-colors">
          {tr.nav.dashboard} →
        </Link>
      </div>
    </footer>
  );
}
