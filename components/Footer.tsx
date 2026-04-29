"use client";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";

export default function Footer() {
  const { lang } = useLang();
  const tr = t[lang];
  const isAr = lang === "ar";

  return (
    <footer
      dir={isAr ? "rtl" : "ltr"}
      className="bg-gray-900 border-t border-white/5 py-8 text-center"
    >
      <p className="text-sm text-gray-500">
        © {new Date().getFullYear()} Itqan — إتقان · {tr.footer.location} · {tr.footer.rights}
      </p>
    </footer>
  );
}
