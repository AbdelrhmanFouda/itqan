"use client";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import { ArrowRight } from "lucide-react";

export default function Hero() {
  const { lang } = useLang();
  const tr = t[lang];
  const isAr = lang === "ar";

  return (
    <section
      dir={isAr ? "rtl" : "ltr"}
      className="min-h-screen flex items-center bg-gradient-to-br from-gray-900 via-gray-800 to-blue-950 text-white"
    >
      <div className="max-w-6xl mx-auto px-6 py-32">
        <div className="max-w-3xl">
          <p className="text-blue-400 text-sm font-semibold uppercase tracking-widest mb-4">
            {tr.hero.tagline}
          </p>
          <h1 className="text-5xl md:text-6xl font-bold leading-tight mb-6">
            إتقان <br />
            <span className="text-blue-400">Itqan</span>
          </h1>
          <p className="text-lg text-gray-300 leading-relaxed mb-10 max-w-xl">
            {tr.hero.subtitle}
          </p>
          <div className={`flex gap-4 flex-wrap ${isAr ? "flex-row-reverse" : ""}`}>
            <a
              href="#contact"
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-lg font-medium transition-colors"
            >
              {tr.hero.cta}
              <ArrowRight size={16} className={isAr ? "rotate-180" : ""} />
            </a>
            <a
              href="#services"
              className="inline-flex items-center gap-2 border border-white/20 hover:border-white/50 text-white px-6 py-3 rounded-lg font-medium transition-colors"
            >
              {tr.hero.services}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
