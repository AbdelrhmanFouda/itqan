"use client";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import { Settings, Weight, Wrench, Box } from "lucide-react";

const icons = [Settings, Weight, Wrench, Box];

export default function Services() {
  const { lang } = useLang();
  const tr = t[lang];
  const isAr = lang === "ar";

  return (
    <section id="services" dir={isAr ? "rtl" : "ltr"} className="py-24 bg-gray-50">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-3">{tr.services.title}</h2>
          <p className="text-gray-500">{tr.services.subtitle}</p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {tr.services.items.map((svc, i) => {
            const Icon = icons[i];
            return (
              <div
                key={i}
                className="bg-white rounded-xl p-6 border border-gray-100 hover:border-blue-200 hover:shadow-md transition-all group"
              >
                <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center mb-4 group-hover:bg-blue-100 transition-colors">
                  <Icon size={20} className="text-blue-600" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">{svc.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{svc.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
