"use client";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import { Settings, Weight, Wrench, Box } from "lucide-react";
import { motion } from "framer-motion";
import { staggerContainer, fadeInUp } from "@/lib/animations";

const icons = [Settings, Weight, Wrench, Box];
const gradients = [
  "from-blue-500 to-cyan-500",
  "from-violet-500 to-blue-500",
  "from-cyan-500 to-teal-500",
  "from-indigo-500 to-violet-500",
];

export default function Services() {
  const { lang } = useLang();
  const tr = t[lang];
  const isAr = lang === "ar";

  return (
    <section id="services" dir={isAr ? "rtl" : "ltr"} className="py-20 sm:py-28 bg-gray-950 relative overflow-hidden">
      {/* Subtle divider glow */}
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
            {isAr ? "ما نقدمه" : "What We Do"}
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">{tr.services.title}</h2>
          <p className="text-gray-500 max-w-xl mx-auto">{tr.services.subtitle}</p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-60px" }}
          variants={staggerContainer}
          className="grid md:grid-cols-2 lg:grid-cols-4 gap-5"
        >
          {tr.services.items.map((svc, i) => {
            const Icon = icons[i];
            return (
              <motion.div
                key={i}
                variants={fadeInUp}
                whileHover={{ y: -8, transition: { duration: 0.25 } }}
                className="group relative bg-gray-900 rounded-2xl p-6 border border-white/5 hover:border-blue-500/30 transition-colors cursor-default overflow-hidden"
              >
                {/* Card glow on hover */}
                <div className="absolute inset-0 bg-gradient-to-br from-blue-600/0 to-blue-600/0 group-hover:from-blue-600/5 group-hover:to-transparent transition-all duration-500 rounded-2xl" />

                <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${gradients[i]} p-0.5 mb-5`}>
                  <div className="w-full h-full bg-gray-900 rounded-[10px] flex items-center justify-center">
                    <Icon size={18} className="text-white" />
                  </div>
                </div>
                <h3 className="font-semibold text-white mb-2 text-[15px]">{svc.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{svc.desc}</p>

                {/* Bottom gradient line */}
                <div className={`absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r ${gradients[i]} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
