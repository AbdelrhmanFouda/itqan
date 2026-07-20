"use client";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import { Mail, Phone } from "lucide-react";
import { motion } from "framer-motion";
import { staggerContainer, fadeInUp } from "@/lib/animations";

const avatarColors = [
  "from-blue-500 to-cyan-500",
  "from-violet-500 to-blue-500",
  "from-cyan-500 to-teal-500",
  "from-indigo-500 to-violet-500",
];

export default function Team() {
  const { lang } = useLang();
  const tr = t[lang];
  const isAr = lang === "ar";

  if (!tr.team.members.length) return null;

  return (
    <section id="team" dir={isAr ? "rtl" : "ltr"} className="py-20 sm:py-28 bg-gray-950 relative overflow-hidden">
      <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-blue-500/20 to-transparent" />

      <div className="max-w-7xl mx-auto px-6">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={fadeInUp}
          className="text-center mb-16"
        >
          <p className="text-blue-400 text-xs font-semibold uppercase tracking-widest mb-3">
            {isAr ? "مهندسونا" : "Our Engineers"}
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">{tr.team.title}</h2>
          <p className="text-gray-500">{tr.team.subtitle}</p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-60px" }}
          variants={staggerContainer}
          className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5"
        >
          {tr.team.members.map((member, i) => (
            <motion.div
              key={i}
              variants={fadeInUp}
              whileHover={{ y: -6, transition: { duration: 0.25 } }}
              className="group bg-gray-900 rounded-2xl p-6 border border-white/5 hover:border-blue-500/30 transition-colors"
            >
              {/* Avatar */}
              <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${avatarColors[i]} p-0.5 mb-4`}>
                <div className="w-full h-full bg-gray-900 rounded-[14px] flex items-center justify-center text-white font-bold text-xl">
                  {member.name.charAt(0)}
                </div>
              </div>

              <h3 className="font-semibold text-white text-[15px]">{member.name}</h3>
              <p className="text-xs text-blue-400 font-medium mt-0.5 mb-3">{member.role}</p>
              <p className="text-sm text-gray-500 leading-relaxed mb-4">{member.bio}</p>

              <div className="space-y-2 border-t border-white/5 pt-4">
                <a
                  href={`mailto:${member.email}`}
                  className="flex items-center gap-2 text-xs text-gray-500 hover:text-blue-400 transition-colors"
                >
                  <Mail size={12} className="shrink-0" />
                  <span className="truncate">{member.email}</span>
                </a>
                <a
                  href={`tel:${member.phone.replace(/\s/g, "")}`}
                  className="flex items-center gap-2 text-xs text-gray-500 hover:text-blue-400 transition-colors"
                >
                  <Phone size={12} className="shrink-0" />
                  <span>{member.phone}</span>
                </a>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
