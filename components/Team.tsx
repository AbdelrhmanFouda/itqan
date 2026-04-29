"use client";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import { Mail, Phone } from "lucide-react";

export default function Team() {
  const { lang } = useLang();
  const tr = t[lang];
  const isAr = lang === "ar";

  return (
    <section id="team" dir={isAr ? "rtl" : "ltr"} className="py-24 bg-white">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-3">{tr.team.title}</h2>
          <p className="text-gray-500">{tr.team.subtitle}</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {tr.team.members.map((member, i) => (
            <div
              key={i}
              className="bg-gray-50 rounded-xl p-6 border border-gray-100 hover:border-blue-200 hover:shadow-sm transition-all"
            >
              <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-lg mb-4">
                {member.name.charAt(0)}
              </div>
              <h3 className="font-semibold text-gray-900">{member.name}</h3>
              <p className="text-xs text-blue-600 font-medium mb-3">{member.role}</p>
              <p className="text-sm text-gray-500 leading-relaxed mb-4">{member.bio}</p>
              <div className="space-y-2 border-t border-gray-200 pt-4">
                <a
                  href={`mailto:${member.email}`}
                  className="flex items-center gap-2 text-xs text-gray-500 hover:text-blue-600 transition-colors"
                >
                  <Mail size={12} className="shrink-0" />
                  <span className="truncate">{member.email}</span>
                </a>
                <a
                  href={`tel:${member.phone.replace(/\s/g, "")}`}
                  className="flex items-center gap-2 text-xs text-gray-500 hover:text-blue-600 transition-colors"
                >
                  <Phone size={12} className="shrink-0" />
                  <span>{member.phone}</span>
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
