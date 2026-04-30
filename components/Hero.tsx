"use client";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import { ArrowRight, ChevronDown, Cog, Zap } from "lucide-react";
import { motion } from "framer-motion";

export default function Hero() {
  const { lang } = useLang();
  const tr = t[lang];
  const isAr = lang === "ar";

  return (
    <section
      dir={isAr ? "rtl" : "ltr"}
      className="relative min-h-screen flex items-center bg-gray-950 overflow-hidden"
    >
      {/* Animated background blobs */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-blue-600/10 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-blue-400/8 rounded-full blur-[100px] animate-pulse" style={{ animationDelay: "1s" }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-900/10 rounded-full blur-[150px]" />
        {/* Grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `linear-gradient(rgba(96,165,250,1) 1px, transparent 1px), linear-gradient(90deg, rgba(96,165,250,1) 1px, transparent 1px)`,
            backgroundSize: "60px 60px",
          }}
        />
      </div>

      <div className="max-w-7xl mx-auto px-6 py-32 w-full relative z-10">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Text */}
          <div className={isAr ? "text-right" : ""}>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="inline-flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 rounded-full px-4 py-1.5 mb-6"
            >
              <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              <span className="text-blue-400 text-xs font-semibold uppercase tracking-widest">
                {tr.hero.tagline}
              </span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.1 }}
              className="text-5xl md:text-7xl font-bold text-white leading-[1.05] mb-6"
            >
              إتقان
              <br />
              <span className="bg-gradient-to-r from-blue-400 via-blue-300 to-cyan-400 bg-clip-text text-transparent">
                Itqan
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.2 }}
              className="text-lg text-gray-400 leading-relaxed mb-10 max-w-lg"
            >
              {tr.hero.subtitle}
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.3 }}
              className={`flex gap-4 flex-wrap ${isAr ? "flex-row-reverse" : ""}`}
            >
              <a
                href="#contact"
                className="group inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-xl font-medium transition-all hover:shadow-lg hover:shadow-blue-500/25 hover:-translate-y-0.5"
              >
                {tr.hero.cta}
                <ArrowRight size={16} className={`group-hover:translate-x-1 transition-transform ${isAr ? "rotate-180" : ""}`} />
              </a>
              <a
                href="#services"
                className="inline-flex items-center gap-2 border border-white/10 hover:border-white/30 bg-white/5 hover:bg-white/10 text-white px-6 py-3 rounded-xl font-medium transition-all hover:-translate-y-0.5"
              >
                {tr.hero.services}
              </a>
            </motion.div>

            {/* Stats row */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 1, delay: 0.6 }}
              className={`flex gap-8 mt-12 pt-8 border-t border-white/5 ${isAr ? "flex-row-reverse" : ""}`}
            >
              {[
                { v: "16+", l: isAr ? "ماكينة" : "Machines" },
                { v: "2", l: isAr ? "قسم" : "Divisions" },
                { v: "100%", l: isAr ? "مصري" : "Egyptian" },
              ].map((s) => (
                <div key={s.l}>
                  <div className="text-2xl font-bold text-white">{s.v}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{s.l}</div>
                </div>
              ))}
            </motion.div>
          </div>

          {/* Machine visual panel */}
          <motion.div
            initial={{ opacity: 0, x: isAr ? -60 : 60 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.9, delay: 0.2, ease: "easeOut" as const }}
            className="relative hidden lg:block"
          >
            {/* Glow */}
            <div className="absolute inset-0 bg-blue-500/15 rounded-3xl blur-3xl scale-110" />
            <div className="relative rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-black/60 bg-gray-900">
              {/* Industrial machine visual */}
              <div className="relative h-[420px] flex items-center justify-center overflow-hidden"
                style={{
                  background: "linear-gradient(135deg, #0f172a 0%, #1e293b 40%, #0f172a 100%)",
                }}>
                {/* Grid lines */}
                <div className="absolute inset-0 opacity-[0.06]"
                  style={{
                    backgroundImage: "linear-gradient(rgba(96,165,250,1) 1px, transparent 1px), linear-gradient(90deg, rgba(96,165,250,1) 1px, transparent 1px)",
                    backgroundSize: "40px 40px",
                  }} />
                {/* Center glow */}
                <div className="absolute inset-0 bg-blue-600/10 rounded-full blur-3xl" />
                {/* Animated rings */}
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                  className="absolute w-72 h-72 rounded-full border border-blue-500/10"
                />
                <motion.div
                  animate={{ rotate: -360 }}
                  transition={{ duration: 14, repeat: Infinity, ease: "linear" }}
                  className="absolute w-52 h-52 rounded-full border border-blue-400/15"
                  style={{ borderStyle: "dashed" }}
                />
                {/* Central icon */}
                <div className="relative flex flex-col items-center gap-4">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
                    className="w-20 h-20 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center"
                  >
                    <Cog size={40} className="text-blue-400" />
                  </motion.div>
                  <div className="flex gap-3 mt-2">
                    {[...Array(3)].map((_, i) => (
                      <motion.div
                        key={i}
                        animate={{ scale: [1, 1.3, 1], opacity: [0.4, 1, 0.4] }}
                        transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.4 }}
                        className="w-2 h-2 rounded-full bg-blue-400"
                      />
                    ))}
                  </div>
                  {/* Stats floating */}
                  <div className="flex gap-6 mt-4">
                    {[{ v: "16+", l: isAr ? "ماكينة" : "Machines" }, { v: "24/7", l: isAr ? "تشغيل" : "Operation" }].map((s) => (
                      <div key={s.l} className="text-center">
                        <div className="text-xl font-bold text-white">{s.v}</div>
                        <div className="text-xs text-gray-500">{s.l}</div>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Corner accents */}
                <div className="absolute top-4 left-4 w-8 h-8 border-l-2 border-t-2 border-blue-500/30 rounded-tl-lg" />
                <div className="absolute top-4 right-4 w-8 h-8 border-r-2 border-t-2 border-blue-500/30 rounded-tr-lg" />
                <div className="absolute bottom-16 left-4 w-8 h-8 border-l-2 border-b-2 border-blue-500/30 rounded-bl-lg" />
                <div className="absolute bottom-16 right-4 w-8 h-8 border-r-2 border-b-2 border-blue-500/30 rounded-br-lg" />
              </div>
              {/* Overlay label */}
              <div className="absolute bottom-4 left-4 right-4 bg-gray-950/80 backdrop-blur rounded-xl px-4 py-3 border border-white/10">
                <p className="text-xs text-blue-400 font-semibold uppercase tracking-wide mb-0.5 flex items-center gap-1.5">
                  <Zap size={10} className="inline" />
                  {isAr ? "قسم الحقن" : "Injection Division"}
                </p>
                <p className="text-sm text-white font-medium">
                  {isAr ? "16+ ماكينة حقن بلاستيك" : "16+ Plastic Injection Machines"}
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Scroll indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1"
      >
        <span className="text-xs text-gray-600 uppercase tracking-widest">Scroll</span>
        <motion.div
          animate={{ y: [0, 6, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
        >
          <ChevronDown size={16} className="text-gray-600" />
        </motion.div>
      </motion.div>
    </section>
  );
}
