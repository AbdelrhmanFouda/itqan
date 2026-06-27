"use client";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import { motion } from "framer-motion";
import { staggerContainer, fadeInUp } from "@/lib/animations";

type Client = { id?: string; name: string; industry: string; logo: string };

export default function Clients() {
  const { lang } = useLang();
  const tr = t[lang];
  const isAr = lang === "ar";
  // Start with the bundled list so the section always renders, then
  // upgrade to live Firestore data if the API returns any.
  const [clients, setClients] = useState<Client[]>(tr.clients.items);

  useEffect(() => {
    fetch("/api/clients")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Client[]) => {
        if (Array.isArray(data) && data.length > 0) setClients(data);
      })
      .catch(() => {});
  }, []);

  return (
    <section
      id="clients"
      dir={isAr ? "rtl" : "ltr"}
      className="py-28 bg-gray-950 relative overflow-hidden"
    >
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
          <h2 className="text-4xl font-bold text-white mb-4">{tr.clients.title}</h2>
          <p className="text-gray-500 max-w-xl mx-auto">{tr.clients.subtitle}</p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-60px" }}
          variants={staggerContainer}
          className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4"
        >
          {clients.map((c, i) => (
            <motion.div
              key={c.id ?? i}
              variants={fadeInUp}
              whileHover={{ y: -6, transition: { duration: 0.25 } }}
              className="group bg-gray-900 rounded-2xl border border-white/5 hover:border-blue-500/20 p-5 flex flex-col items-center justify-center text-center gap-3 transition-colors"
            >
              <div className="w-16 h-16 relative rounded-xl overflow-hidden bg-white flex items-center justify-center">
                {c.logo ? (
                  <Image
                    src={c.logo}
                    alt={c.name}
                    fill
                    sizes="64px"
                    className="object-contain p-2 group-hover:scale-110 transition-transform duration-500"
                  />
                ) : (
                  <span className="text-xl font-bold text-blue-400">{c.name.charAt(0)}</span>
                )}
              </div>
              <div>
                <p className="text-sm font-medium text-white leading-tight">{c.name}</p>
                {c.industry && <p className="text-xs text-gray-500 mt-0.5">{c.industry}</p>}
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
