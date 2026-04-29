"use client";
import Link from "next/link";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import { Menu, X } from "lucide-react";
import { useState } from "react";

export default function Navbar() {
  const { lang, setLang } = useLang();
  const tr = t[lang];
  const [open, setOpen] = useState(false);
  const isAr = lang === "ar";

  return (
    <nav
      dir={isAr ? "rtl" : "ltr"}
      className="fixed top-0 inset-x-0 z-50 bg-white/90 backdrop-blur border-b border-gray-100"
    >
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="font-bold text-xl tracking-tight text-gray-900">
          إتقان <span className="text-blue-600">Itqan</span>
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-8">
          <a href="#services" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">
            {tr.nav.services}
          </a>
          <a href="#about" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">
            {tr.nav.about}
          </a>
          <a href="#contact" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">
            {tr.nav.contact}
          </a>
          <Link
            href="/dashboard"
            className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            {tr.nav.dashboard}
          </Link>
          <button
            onClick={() => setLang(isAr ? "en" : "ar")}
            className="text-sm px-3 py-1.5 rounded-md border border-gray-200 hover:border-blue-400 hover:text-blue-600 transition-colors font-medium"
          >
            {isAr ? "EN" : "عربي"}
          </button>
        </div>

        {/* Mobile */}
        <div className="flex md:hidden items-center gap-3">
          <button
            onClick={() => setLang(isAr ? "en" : "ar")}
            className="text-sm px-2.5 py-1 rounded border border-gray-200 font-medium"
          >
            {isAr ? "EN" : "عربي"}
          </button>
          <button onClick={() => setOpen(!open)}>
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden border-t border-gray-100 bg-white px-6 py-4 flex flex-col gap-4">
          <a href="#services" onClick={() => setOpen(false)} className="text-sm text-gray-700">
            {tr.nav.services}
          </a>
          <a href="#about" onClick={() => setOpen(false)} className="text-sm text-gray-700">
            {tr.nav.about}
          </a>
          <a href="#contact" onClick={() => setOpen(false)} className="text-sm text-gray-700">
            {tr.nav.contact}
          </a>
          <Link href="/dashboard" onClick={() => setOpen(false)} className="text-sm text-gray-700">
            {tr.nav.dashboard}
          </Link>
        </div>
      )}
    </nav>
  );
}
