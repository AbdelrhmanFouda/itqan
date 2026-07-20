"use client";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import { CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";
import { staggerContainer, fadeInUp } from "@/lib/animations";

const catColors = [
  "border-blue-500/30 text-blue-400",
  "border-violet-500/30 text-violet-400",
  "border-cyan-500/30 text-cyan-400",
  "border-teal-500/30 text-teal-400",
];
const dotColors = ["text-blue-400", "text-violet-400", "text-cyan-400", "text-teal-400"];

export default function Tools() {
  const { lang } = useLang();
  const tr = t[lang];
  const isAr = lang === "ar";

  if (!tr.tools.categories.length) return null;

  return (
    <section id="tools" dir={isAr ? "rtl" : "ltr"} className="py-20 sm:py-28 bg-gray-950 relative overflow-hidden">
      <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-blue-500/20 to-transparent" />

      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[800px] h-[300px] bg-blue-600/5 rounded-full blur-3xl" />
      </div>

      <div className="max-w-7xl mx-auto px-6 relative">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={fadeInUp}
          className="text-center mb-16"
        >
          <p className="text-blue-400 text-xs font-semibold uppercase tracking-widest mb-3">
            {isAr ? "أصولنا" : "Our Assets"}
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">{tr.tools.title}</h2>
          <p className="text-gray-500">{tr.tools.subtitle}</p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-60px" }}
          variants={staggerContainer}
          className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5"
        >
          {tr.tools.categories.map((cat, i) => (
            <motion.div
              key={i}
              variants={fadeInUp}
              whileHover={{ y: -4, transition: { duration: 0.2 } }}
              className={`bg-gray-900 rounded-2xl border border-white/5 hover:${catColors[i].split(" ")[0]} p-6 transition-colors group`}
            >
              <h3 className={`font-semibold text-sm uppercase tracking-wide mb-4 pb-3 border-b border-white/5 ${catColors[i].split(" ")[1]}`}>
                {cat.name}
              </h3>
              <ul className="space-y-4">
                {cat.items.map((item, j) => (
                  <li key={j} className="flex gap-3">
                    <CheckCircle2 size={14} className={`${dotColors[i]} mt-0.5 shrink-0`} />
                    <div>
                      <p className="text-sm font-medium text-gray-200">{item.name}</p>
                      <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">{item.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
