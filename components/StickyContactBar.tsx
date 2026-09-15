"use client";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import { Phone, MessageCircle } from "lucide-react";
import { COMPANY, WHATSAPP_URL } from "@/lib/company";
import { trackConversion } from "@/lib/ads";

/**
 * Phones only: WhatsApp + call pinned to the bottom of the screen, so an ad
 * visitor is one tap from a conversation wherever they have scrolled.
 * app/page.tsx pads the page bottom by the bar's height on phones.
 */
export default function StickyContactBar() {
  const { lang } = useLang();
  const tr = t[lang];
  const isAr = lang === "ar";
  const btn =
    "flex-1 inline-flex items-center justify-center gap-2 min-h-12 rounded-xl text-sm font-semibold " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60";

  return (
    <div
      dir={isAr ? "rtl" : "ltr"}
      className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-gray-950/95 backdrop-blur-xl border-t border-white/10 px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]"
    >
      <div className="flex gap-2">
        <a
          href={WHATSAPP_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => trackConversion("whatsapp")}
          className={`${btn} bg-green-600 active:bg-green-500 text-white`}
        >
          <MessageCircle size={18} />
          {tr.nav.whatsapp}
        </a>
        <a
          href={`tel:${COMPANY.phone.tel}`}
          onClick={() => trackConversion("call")}
          className={`${btn} bg-blue-600 active:bg-blue-500 text-white`}
        >
          <Phone size={18} />
          {tr.nav.call}
        </a>
      </div>
    </div>
  );
}
