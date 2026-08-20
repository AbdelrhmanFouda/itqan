"use client";
import Link from "next/link";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import { Menu, X } from "lucide-react";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

export default function Navbar() {
  const { lang, setLang } = useLang();
  const tr = t[lang];
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const isAr = lang === "ar";

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const navLinks = [
    { href: "#services", label: tr.nav.services },
    { href: "#about", label: tr.nav.about },
    { href: "#team", label: tr.nav.team },
    // #products removed with the section (2026-08-20) — no product names on the landing page.
    { href: "#clients", label: tr.nav.clients },
    { href: "#tools", label: tr.nav.tools },
    { href: "#contact", label: tr.nav.contact },
  ];

  return (
    <motion.nav
      dir={isAr ? "rtl" : "ltr"}
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-gray-950/90 backdrop-blur-xl border-b border-white/5 shadow-xl shadow-black/20"
          : "bg-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm group-hover:bg-blue-500 transition-colors">
            إ
          </div>
          <span className="font-bold text-lg text-white tracking-tight">
            Itqan <span className="text-blue-400">إتقان</span>
          </span>
        </Link>

        {/* Desktop */}
        <div className="hidden md:flex items-center gap-7">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm text-gray-400 hover:text-white transition-colors relative group"
            >
              {link.label}
              <span className="absolute -bottom-0.5 start-0 w-0 h-px bg-blue-400 group-hover:w-full transition-all duration-300" />
            </a>
          ))}
          <Link
            href="/dashboard"
            className="text-sm text-gray-400 hover:text-white transition-colors relative group"
          >
            {tr.nav.dashboard}
            <span className="absolute -bottom-0.5 start-0 w-0 h-px bg-blue-400 group-hover:w-full transition-all duration-300" />
          </Link>
          <button
            onClick={() => setLang(isAr ? "en" : "ar")}
            className="text-sm px-3 py-1.5 rounded-lg border border-white/10 hover:border-blue-500/50 text-gray-300 hover:text-white hover:bg-blue-500/10 transition-all font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          >
            {isAr ? "EN" : "عربي"}
          </button>
        </div>

        {/* Mobile */}
        <div className="flex md:hidden items-center gap-2">
          <button
            onClick={() => setLang(isAr ? "en" : "ar")}
            className="text-sm px-3 py-2 min-h-11 rounded border border-white/10 text-gray-300 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          >
            {isAr ? "EN" : "عربي"}
          </button>
          <button
            onClick={() => setOpen(!open)}
            aria-label={open ? (isAr ? "إغلاق القائمة" : "Close menu") : (isAr ? "القائمة" : "Menu")}
            aria-expanded={open}
            className="text-white p-2.5 -me-2.5 min-h-11 min-w-11 inline-flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 rounded-lg"
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="md:hidden bg-gray-950/95 backdrop-blur-xl border-t border-white/5 overflow-hidden"
          >
            <div className="px-6 py-4 flex flex-col gap-1">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="text-sm text-gray-300 hover:text-white transition-colors py-2.5 min-h-11 flex items-center"
                >
                  {link.label}
                </a>
              ))}
              <Link
                href="/dashboard"
                onClick={() => setOpen(false)}
                className="text-sm text-gray-300 hover:text-white transition-colors py-2.5 min-h-11 flex items-center"
              >
                {tr.nav.dashboard}
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  );
}
