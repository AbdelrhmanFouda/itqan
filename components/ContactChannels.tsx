"use client";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import { Phone, MessageCircle } from "lucide-react";
import { COMPANY, WHATSAPP_URL } from "@/lib/company";
import { trackConversion } from "@/lib/ads";

/**
 * Direct contact channels — click-to-call and WhatsApp. Egyptian industrial
 * buyers enquire by phone; a form-only site reads as a company that does not
 * want the work. The number is lib/company.ts (owner-supplied 2026-09-15) —
 * it used to come from env, which had drifted to the second number.
 * Each tap fires its Google Ads conversion (inert until configured).
 */
export default function ContactChannels({ size = "nav" }: { size?: "nav" | "hero" }) {
  const { lang } = useLang();
  const tr = t[lang];

  const base =
    "inline-flex items-center gap-2 rounded-lg font-medium transition-colors " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 " +
    (size === "hero" ? "px-5 py-3 min-h-12 text-sm" : "px-3 py-2 min-h-11 text-sm");

  return (
    <>
      <a
        href={WHATSAPP_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => trackConversion("whatsapp")}
        className={`${base} bg-green-600 hover:bg-green-500 text-white`}
      >
        <MessageCircle size={16} />
        {tr.nav.whatsapp}
      </a>
      <a
        href={`tel:${COMPANY.phone.tel}`}
        onClick={() => trackConversion("call")}
        className={`${base} border border-white/15 text-gray-200 hover:text-white hover:border-blue-500/50 hover:bg-blue-500/10`}
      >
        <Phone size={16} />
        <span dir="ltr">{size === "hero" ? COMPANY.phone.display : tr.nav.call}</span>
      </a>
    </>
  );
}
