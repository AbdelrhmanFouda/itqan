"use client";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import { useState } from "react";

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
    <section id="contact" dir={isAr ? "rtl" : "ltr"} className="py-24 bg-gray-900 text-white">
      <div className="max-w-2xl mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-3">{tr.contact.title}</h2>
          <p className="text-gray-400">{tr.contact.subtitle}</p>
        </div>

        {sent ? (
          <div className="bg-blue-600/20 border border-blue-500/30 rounded-xl p-8 text-center text-blue-300 text-lg">
            {tr.contact.sent}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid sm:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">{tr.contact.name}</label>
                <input
                  name="name"
                  required
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">{tr.contact.company}</label>
                <input
                  name="company"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">{tr.contact.phone}</label>
                <input
                  name="phone"
                  type="tel"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">{tr.contact.email}</label>
                <input
                  name="email"
                  type="email"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">{tr.contact.type}</label>
              <select
                name="inquiry_type"
                className="w-full bg-gray-800 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors"
              >
                {tr.contact.types.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">{tr.contact.message}</label>
              <textarea
                name="message"
                rows={4}
                required
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors resize-none"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white py-3 rounded-lg font-medium transition-colors"
            >
              {loading ? "..." : tr.contact.send}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
