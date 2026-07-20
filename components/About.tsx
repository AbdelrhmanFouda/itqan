"use client";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import { motion } from "framer-motion";
import { fadeInLeft, fadeInRight } from "@/lib/animations";
import { Settings, Layers, BarChart3, Wrench } from "lucide-react";

export default function About() {
  const { lang } = useLang();
  const tr = t[lang];
  const isAr = lang === "ar";

  return (
    <section id="about" dir={isAr ? "rtl" : "ltr"} className="py-20 sm:py-28 bg-gray-900 relative overflow-hidden">
      <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/5 to-transparent" />
      <div className="absolute bottom-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/5 to-transparent" />

      <div className="max-w-7xl mx-auto px-6">
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          {/* CNC Machine Visual */}
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={isAr ? fadeInRight : fadeInLeft}
            className="relative"
          >
            <div className="absolute -inset-4 bg-blue-500/8 rounded-3xl blur-2xl" />
            <div className="relative rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-black/50">
              {/* Industrial CNC visual */}
              <div className="relative h-[400px] overflow-hidden"
                style={{ background: "linear-gradient(135deg, #0a0f1e 0%, #111827 50%, #0d1117 100%)" }}>
                {/* Grid */}
                <div className="absolute inset-0 opacity-[0.05]"
                  style={{
                    backgroundImage: "linear-gradient(rgba(96,165,250,1) 1px, transparent 1px), linear-gradient(90deg, rgba(96,165,250,1) 1px, transparent 1px)",
                    backgroundSize: "30px 30px",
                  }} />
                {/* Radial glow */}
                <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-cyan-600/10 rounded-full blur-3xl" />
                {/* CNC Machine schematic */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="relative w-72 h-72">
                    {/* Outer frame */}
                    <div className="absolute inset-0 border-2 border-blue-500/20 rounded-xl" />
                    {/* X-axis rail */}
                    <div className="absolute top-1/3 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-blue-400/40 to-transparent" />
                    {/* Y-axis rail */}
                    <div className="absolute top-0 bottom-0 left-1/2 w-0.5 bg-gradient-to-b from-transparent via-cyan-400/40 to-transparent" />
                    {/* Spindle head */}
                    <motion.div
                      animate={{
                        x: [-40, 40, 40, -40, -40],
                        y: [-30, -30, 30, 30, -30],
                      }}
                      transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
                      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                    >
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                        className="w-6 h-6 rounded-full border-2 border-cyan-400/70 flex items-center justify-center"
                      >
                        <div className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                      </motion.div>
                    </motion.div>
                    {/* Corner markers */}
                    {[
                      { t: "0", l: "8", label: "X:0 Y:0" },
                      { t: "0", r: "8", label: "X:MAX" },
                      { b: "8", l: "8", label: "Y:MAX" },
                    ].map((pos, i) => (
                      <div
                        key={i}
                        className="absolute text-[9px] text-blue-400/50 font-mono"
                        style={{ top: pos.t, left: pos.l, right: pos.r, bottom: pos.b }}
                      >
                        {pos.label}
                      </div>
                    ))}
                    {/* Info cards */}
                    <div className="absolute -bottom-14 left-1/2 -translate-x-1/2 flex gap-4 whitespace-nowrap">
                      {[
                        { icon: <Settings size={14} />, label: isAr ? "3 محاور" : "3-Axis" },
                        { icon: <BarChart3 size={14} />, label: isAr ? "دقة عالية" : "High Precision" },
                      ].map((item, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-xs text-gray-400 bg-gray-900/80 rounded-lg px-3 py-1.5 border border-white/5">
                          <span className="text-blue-400">{item.icon}</span>
                          {item.label}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                {/* Tool icons */}
                <div className="absolute top-4 right-4 flex flex-col gap-2">
                  {[Wrench, Layers, Settings].map((Icon, i) => (
                    <motion.div
                      key={i}
                      animate={{ opacity: [0.3, 0.7, 0.3] }}
                      transition={{ duration: 2, repeat: Infinity, delay: i * 0.6 }}
                      className="w-8 h-8 bg-gray-800 rounded-lg border border-white/5 flex items-center justify-center"
                    >
                      <Icon size={14} className="text-gray-500" />
                    </motion.div>
                  ))}
                </div>
                {/* Bottom gradient */}
                <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-gray-950/80 to-transparent" />
              </div>
              <div className="absolute bottom-4 left-4 bg-gray-950/80 backdrop-blur rounded-xl px-4 py-2.5 border border-white/10">
                <p className="text-xs text-blue-400 font-semibold uppercase tracking-wide">
                  {isAr ? "مركز CNC" : "CNC Machining Center"}
                </p>
                <p className="text-sm text-white">{isAr ? "تصنيع القوالب داخلياً" : "In-House Mold Manufacturing"}</p>
              </div>
            </div>
          </motion.div>

          {/* Text content */}
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={isAr ? fadeInLeft : fadeInRight}
          >
            <p className="text-blue-400 text-xs font-semibold uppercase tracking-widest mb-3">
              {isAr ? "من نحن" : "About Us"}
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-6">{tr.about.title}</h2>
            <p className="text-gray-400 leading-relaxed text-lg">{tr.about.body}</p>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
