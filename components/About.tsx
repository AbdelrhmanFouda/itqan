"use client";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";

export default function About() {
  const { lang } = useLang();
  const tr = t[lang];
  const isAr = lang === "ar";

  return (
    <section id="about" dir={isAr ? "rtl" : "ltr"} className="py-24 bg-white">
      <div className="max-w-6xl mx-auto px-6">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <div>
            <h2 className="text-3xl font-bold text-gray-900 mb-6">{tr.about.title}</h2>
            <p className="text-gray-600 leading-relaxed text-lg">{tr.about.body}</p>
          </div>
          <div className="grid grid-cols-2 gap-6">
            {tr.about.facts.map((fact, i) => (
              <div
                key={i}
                className="bg-gray-50 rounded-xl p-6 border border-gray-100 text-center"
              >
                <div className="text-3xl font-bold text-blue-600 mb-1">{fact.value}</div>
                <div className="text-sm text-gray-500">{fact.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
