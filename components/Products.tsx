"use client";
import { useEffect, useState } from "react";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import { motion } from "framer-motion";
import { staggerContainer, fadeInUp } from "@/lib/animations";

type P = { name: string; material: string };

const bgPatterns = [
  "from-blue-900/30 to-gray-900",
  "from-violet-900/30 to-gray-900",
  "from-cyan-900/30 to-gray-900",
  "from-indigo-900/30 to-gray-900",
  "from-teal-900/30 to-gray-900",
  "from-blue-900/20 to-gray-900",
];

export default function Products() {
  const { lang } = useLang();
  const tr = t[lang];
  const isAr = lang === "ar";
  const [items, setItems] = useState<P[]>([]);

  useEffect(() => {
    fetch("/api/public/showcase")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (Array.isArray(d?.products)) setItems(d.products.slice(0, 9)); })
      .catch(() => {});
  }, []);

  if (items.length === 0) return null;

  return (
    <section id="products" dir={isAr ? "rtl" : "ltr"} className="py-20 sm:py-28 bg-gray-900 relative overflow-hidden">
      <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/5 to-transparent" />

      <div className="max-w-7xl mx-auto px-6">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={fadeInUp}
          className="text-center mb-16"
        >
          <p className="text-blue-400 text-xs font-semibold uppercase tracking-widest mb-3">
            {isAr ? "ما صنعناه" : "Our Work"}
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">{tr.products.title}</h2>
          <p className="text-gray-500 max-w-xl mx-auto">{tr.products.subtitle}</p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-60px" }}
          variants={staggerContainer}
          className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5"
        >
          {items.map((item, i) => (
            <motion.div
              key={`${item.name}-${i}`}
              variants={fadeInUp}
              whileHover={{ y: -6, transition: { duration: 0.25 } }}
              className="group bg-gray-950 rounded-2xl border border-white/5 hover:border-blue-500/20 overflow-hidden transition-colors"
            >
              <div className={`h-40 bg-gradient-to-br ${bgPatterns[i % bgPatterns.length]} relative overflow-hidden`}>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-20 h-20 rounded-2xl border border-white/10 bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform duration-500">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/40 to-cyan-500/40" />
                  </div>
                </div>
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/3 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
              </div>
              <div className="p-5">
                <div className={`flex items-start justify-between gap-3 ${isAr ? "flex-row-reverse" : ""}`}>
                  <h3 className="font-semibold text-white leading-snug text-[15px]">{item.name}</h3>
                  {item.material && (
                    <span className="text-xs px-2.5 py-1 rounded-full border border-blue-500/20 bg-blue-500/10 text-blue-400 whitespace-nowrap shrink-0">
                      {item.material}
                    </span>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
