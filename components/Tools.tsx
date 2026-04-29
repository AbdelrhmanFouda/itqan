"use client";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import { CheckCircle2 } from "lucide-react";

export default function Tools() {
  const { lang } = useLang();
  const tr = t[lang];
  const isAr = lang === "ar";

  return (
    <section id="tools" dir={isAr ? "rtl" : "ltr"} className="py-24 bg-white">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-3">{tr.tools.title}</h2>
          <p className="text-gray-500">{tr.tools.subtitle}</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {tr.tools.categories.map((cat, i) => (
            <div key={i} className="bg-gray-50 rounded-xl border border-gray-100 p-6">
              <h3 className="font-semibold text-gray-900 mb-4 pb-3 border-b border-gray-200">
                {cat.name}
              </h3>
              <ul className="space-y-3">
                {cat.items.map((item, j) => (
                  <li key={j} className="flex gap-3">
                    <CheckCircle2 size={15} className="text-blue-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-gray-800">{item.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{item.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
