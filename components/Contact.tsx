"use client";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import { useState } from "react";
import { motion } from "framer-motion";
import { fadeInUp, staggerContainer } from "@/lib/animations";
import { Send, CheckCircle } from "lucide-react";

export default function Contact() {
  const { lang } = useLang();
  const tr = t[lang];
  const isAr = lang === "ar";
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    await fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setSent(true);
    setLoading(false);
  }

  return (
    <section id="contact" dir={isAr ? "rtl" : "ltr"} className="py-20 sm:py-28 bg-gray-900 relative overflow-hidden">
      <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/5 to-transparent" />
      {/* Glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-blue-600/8 rounded-full blur-3xl" />
      </div>

      <div className="max-w-2xl mx-auto px-6 relative">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={fadeInUp}
          className="text-center mb-12"
        >
          <p className="text-blue-400 text-xs font-semibold uppercase tracking-widest mb-3">
            {isAr ? "ابدأ المشروع" : "Start a Project"}
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">{tr.contact.title}</h2>
          <p className="text-gray-500">{tr.contact.subtitle}</p>
        </motion.div>

        {sent ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-10 text-center"
          >
            <CheckCircle className="w-12 h-12 text-blue-400 mx-auto mb-4" />
            <p className="text-white text-lg font-medium">{tr.contact.sent}</p>
          </motion.div>
        ) : (
          <motion.form
            onSubmit={handleSubmit}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-60px" }}
            variants={staggerContainer}
            className="space-y-4"
          >
            <motion.div variants={fadeInUp} className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">{tr.contact.name}</label>
                <input
                  name="name"
                  required
                  className="w-full bg-gray-950 border border-white/8 hover:border-white/15 focus:border-blue-500/50 rounded-xl px-4 py-3 text-white text-sm placeholder-gray-700 focus:outline-none transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">{tr.contact.company}</label>
                <input
                  name="company"
                  className="w-full bg-gray-950 border border-white/8 hover:border-white/15 focus:border-blue-500/50 rounded-xl px-4 py-3 text-white text-sm placeholder-gray-700 focus:outline-none transition-colors"
                />
              </div>
            </motion.div>
            <motion.div variants={fadeInUp} className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">{tr.contact.phone}</label>
                <input
                  name="phone"
                  type="tel"
                  className="w-full bg-gray-950 border border-white/8 hover:border-white/15 focus:border-blue-500/50 rounded-xl px-4 py-3 text-white text-sm placeholder-gray-700 focus:outline-none transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">{tr.contact.email}</label>
                <input
                  name="email"
                  type="email"
                  className="w-full bg-gray-950 border border-white/8 hover:border-white/15 focus:border-blue-500/50 rounded-xl px-4 py-3 text-white text-sm placeholder-gray-700 focus:outline-none transition-colors"
                />
              </div>
            </motion.div>
            <motion.div variants={fadeInUp}>
              <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">{tr.contact.type}</label>
              <select
                name="inquiry_type"
                className="w-full bg-gray-950 border border-white/8 hover:border-white/15 focus:border-blue-500/50 rounded-xl px-4 py-3 text-white text-sm focus:outline-none transition-colors"
              >
                {tr.contact.types.map((type) => (
                  <option key={type} value={type} className="bg-gray-950">{type}</option>
                ))}
              </select>
            </motion.div>
            <motion.div variants={fadeInUp}>
              <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">{tr.contact.message}</label>
              <textarea
                name="message"
                rows={4}
                required
                className="w-full bg-gray-950 border border-white/8 hover:border-white/15 focus:border-blue-500/50 rounded-xl px-4 py-3 text-white text-sm placeholder-gray-700 focus:outline-none transition-colors resize-none"
              />
            </motion.div>
            <motion.div variants={fadeInUp}>
              <button
                type="submit"
                disabled={loading}
                className="w-full group flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white py-3.5 rounded-xl font-medium transition-all hover:shadow-lg hover:shadow-blue-500/25"
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    {tr.contact.send}
                    <Send size={15} className="group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </button>
            </motion.div>
          </motion.form>
        )}
      </div>
    </section>
  );
}
