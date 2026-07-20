"use client";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import { motion } from "framer-motion";
import { staggerContainer, fadeInUp } from "@/lib/animations";

/**
 * A small, curated set of our larger clients for the public home page.
 * Kept intentionally simple — just edit this list to change who's featured.
 * (The dashboard still shows the full client list from the Google Sheet.)
 */
const FEATURED: { en: string; ar: string }[] = [
  { en: "Idaco", ar: "ايداكو" },
  { en: "MG", ar: "إم جي" },
  { en: "Al-Shams", ar: "الشمس" },
  { en: "El Madina", ar: "المدينة" },
  { en: "Smart Egyptian", ar: "المصرية الذكية" },
  { en: "Mega", ar: "ميجا" },
];

export default function Clients() {
  const { lang } = useLang();
  const tr = t[lang];
  const isAr = lang === "ar";

  return (
    <section id="clients" dir={isAr ? "rtl" : "ltr"} className="py-20 sm:py-28 bg-gray-950 relative overflow-hidden">
      <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-blue-500/30 to-transparent" />

      <div className="max-w-7xl mx-auto px-6">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={fadeInUp}
          className="text-center mb-16"
        >
          <p className="text-blue-400 text-xs font-semibold uppercase tracking-widest mb-3">
            {isAr ? "شركاؤنا" : "Our Clients"}
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">{tr.clients.title}</h2>
          <p className="text-gray-500 max-w-xl mx-auto">{tr.clients.subtitle}</p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-60px" }}
          variants={staggerContainer}
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 max-w-4xl mx-auto"
        >
          {FEATURED.map((c) => {
            const name = isAr ? c.ar : c.en;
            return (
              <motion.div
                key={c.en}
                variants={fadeInUp}
                whileHover={{ y: -6, transition: { duration: 0.25 } }}
                className="group bg-gray-900 rounded-2xl border border-white/5 hover:border-blue-500/20 p-5 flex flex-col items-center justify-center text-center gap-3 transition-colors"
              >
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 border border-white/10 flex items-center justify-center text-xl font-bold text-blue-300 group-hover:scale-110 transition-transform">
                  {name.charAt(0)}
                </div>
                <p className="text-sm font-medium text-gray-200 leading-tight">{name}</p>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
