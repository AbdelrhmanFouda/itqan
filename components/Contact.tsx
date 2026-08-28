"use client";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import { useState } from "react";
import { motion } from "framer-motion";
import { fadeInUp, staggerContainer } from "@/lib/animations";
import { Send, CheckCircle } from "lucide-react";
import ContactChannels from "@/components/ContactChannels";

export default function Contact() {
  const { lang } = useLang();
  const tr = t[lang];
  const isAr = lang === "ar";
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState(false);
  const [needContact, setNeedContact] = useState(false);
  const [loading, setLoading] = useState(false);

  /**
   * Success is claimed ONLY on a confirmed 2xx. This used to call setSent(true)
   * unconditionally, so a visitor whose enquiry hit a 500 (or no network) was
   * told «تم الإرسال» while no record existed anywhere that they tried — a lead
   * lost with a green checkmark on it. On failure the form stays filled and the
   * visitor is told to retry.
   */
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setFailed(false);
    setNeedContact(false);
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    // A lead with no phone AND no email cannot be answered — someone once could
    // describe a whole project and leave no way to reply. Require at least one
    // channel before anything is sent; the server enforces the same rule
    // (reason: "missing_contact") against scripted POSTs.
    if (!data.phone?.trim() && !data.email?.trim()) {
      setNeedContact(true);
      setLoading(false);
      return;
    }
    // Attribution: utm_* + referrer, captured at submit. Must exist BEFORE any
    // ad money is spent — it cannot be reconstructed retrospectively.
    try {
      const q = new URLSearchParams(window.location.search);
      const parts: string[] = [];
      for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
        const v = q.get(k);
        if (v) parts.push(`${k}=${v}`);
      }
      if (document.referrer) parts.push(`ref=${document.referrer}`);
      data.source = parts.join("&").slice(0, 500);
    } catch { /* attribution must never block the enquiry itself */ }
    const res = await fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).catch(() => null);
    if (res && res.ok) {
      setSent(true);
    } else {
      const j = res ? ((await res.json().catch(() => null)) as { reason?: string } | null) : null;
      if (j?.reason === "missing_contact") setNeedContact(true);
      else setFailed(true);
    }
    setLoading(false);
  }

  return (
    <section id="contact" dir={isAr ? "rtl" : "ltr"} className="py-16 sm:py-24 bg-gray-900 relative overflow-hidden">
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
          className="max-w-2xl mx-auto text-center mb-10 sm:mb-14"
        >
          <p className="text-blue-500 text-sm font-medium tracking-wide mb-3">
            {isAr ? "ابدأ المشروع" : "Start a Project"}
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">{tr.contact.title}</h2>
          <p className="text-gray-500">{tr.contact.subtitle}</p>
          {/* Phone-first channels above the form — most buyers here call or
              WhatsApp rather than type. Hidden until the env carries a number. */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <ContactChannels size="hero" />
          </div>
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
                <label htmlFor="contact-name" className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">{tr.contact.name}</label>
                <input
                  id="contact-name"
                  name="name"
                  autoComplete="name"
                  required
                  className="w-full bg-gray-950 border border-white/8 hover:border-white/15 focus:border-blue-500/50 rounded-xl px-4 py-3 text-white text-base sm:text-sm placeholder-gray-700 focus:outline-none transition-colors"
                />
              </div>
              <div>
                <label htmlFor="contact-company" className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">{tr.contact.company}</label>
                <input
                  id="contact-company"
                  name="company"
                  autoComplete="organization"
                  className="w-full bg-gray-950 border border-white/8 hover:border-white/15 focus:border-blue-500/50 rounded-xl px-4 py-3 text-white text-base sm:text-sm placeholder-gray-700 focus:outline-none transition-colors"
                />
              </div>
            </motion.div>
            <motion.div variants={fadeInUp} className="grid sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="contact-phone" className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">{tr.contact.phone}</label>
                <input
                  id="contact-phone"
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  className="w-full bg-gray-950 border border-white/8 hover:border-white/15 focus:border-blue-500/50 rounded-xl px-4 py-3 text-white text-base sm:text-sm placeholder-gray-700 focus:outline-none transition-colors"
                />
              </div>
              <div>
                <label htmlFor="contact-email" className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">{tr.contact.email}</label>
                <input
                  id="contact-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  className="w-full bg-gray-950 border border-white/8 hover:border-white/15 focus:border-blue-500/50 rounded-xl px-4 py-3 text-white text-base sm:text-sm placeholder-gray-700 focus:outline-none transition-colors"
                />
              </div>
            </motion.div>
            {needContact && (
              <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-300 text-sm">
                {tr.contact.needContact}
              </div>
            )}
            <motion.div variants={fadeInUp}>
              <label htmlFor="contact-type" className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">{tr.contact.type}</label>
              <select
                id="contact-type"
                name="inquiry_type"
                className="w-full bg-gray-950 border border-white/8 hover:border-white/15 focus:border-blue-500/50 rounded-xl px-4 py-3 text-white text-base sm:text-sm focus:outline-none transition-colors"
              >
                {tr.contact.types.map((type) => (
                  <option key={type} value={type} className="bg-gray-950">{type}</option>
                ))}
              </select>
            </motion.div>
            <motion.div variants={fadeInUp}>
              <label htmlFor="contact-message" className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">{tr.contact.message}</label>
              <textarea
                id="contact-message"
                name="message"
                rows={4}
                required
                className="w-full bg-gray-950 border border-white/8 hover:border-white/15 focus:border-blue-500/50 rounded-xl px-4 py-3 text-white text-base sm:text-sm placeholder-gray-700 focus:outline-none transition-colors resize-y"
              />
            </motion.div>
            {failed && (
              <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-300 text-sm">
                {tr.contact.failed}
              </div>
            )}
            <motion.div variants={fadeInUp}>
              <button
                type="submit"
                disabled={loading}
                className="w-full group flex items-center justify-center gap-2 min-h-12 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white py-3.5 rounded-xl font-medium transition-colors hover:shadow-lg hover:shadow-blue-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1"
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
