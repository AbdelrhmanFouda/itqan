"use client";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";

export default function Products() {
  const { lang } = useLang();
  const tr = t[lang];
  const isAr = lang === "ar";

  return (
    <section id="products" dir={isAr ? "rtl" : "ltr"} className="py-24 bg-gray-50">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-3">{tr.products.title}</h2>
          <p className="text-gray-500">{tr.products.subtitle}</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {tr.products.items.map((item, i) => (
            <div
              key={i}
              className="bg-white rounded-xl border border-gray-100 hover:border-blue-200 hover:shadow-md transition-all overflow-hidden group"
            >
              {/* Placeholder visual */}
              <div className="h-36 bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
                <div className="w-16 h-16 rounded-lg bg-white/60 border border-gray-200 flex items-center justify-center">
                  <div className="w-8 h-8 rounded bg-blue-100" />
                </div>
              </div>
              <div className="p-5">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="font-semibold text-gray-900 leading-snug">{item.title}</h3>
                  <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full whitespace-nowrap shrink-0">
                    {item.tag}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mb-2">{item.category}</p>
                <p className="text-sm text-gray-500 leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
