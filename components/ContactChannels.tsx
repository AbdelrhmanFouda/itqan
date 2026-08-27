"use client";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import { Phone, MessageCircle } from "lucide-react";

/**
 * Direct contact channels — click-to-call and WhatsApp. Egyptian industrial
 * buyers enquire by phone; a form-only site reads as a company that does not
 * want the work.
 *
 * THE NUMBER COMES FROM ENV, AND NOTHING RENDERS WITHOUT IT — the owner
 * supplies it; a placeholder must never ship:
 *   NEXT_PUBLIC_CONTACT_PHONE  display + tel: form, e.g. "+20 100 123 4567"
 *   NEXT_PUBLIC_WHATSAPP       digits only for wa.me, e.g. "201001234567"
 *                              (optional — falls back to the phone's digits)
 * NEXT_PUBLIC_* is inlined at BUILD time: after setting them in Vercel, a
 * redeploy is required before the buttons appear.
 */

const PHONE = (process.env.NEXT_PUBLIC_CONTACT_PHONE ?? "").trim();
const WA_DIGITS = (process.env.NEXT_PUBLIC_WHATSAPP ?? PHONE).replace(/\D/g, "");
const WA_TEXT = encodeURIComponent(
  "السلام عليكم، أريد الاستفسار عن خدمات إتقان للصناعات البلاستيكية.",
);

export default function ContactChannels({ size = "nav" }: { size?: "nav" | "hero" }) {
  const { lang } = useLang();
  const tr = t[lang];
  if (!PHONE) return null;

  const base =
    "inline-flex items-center gap-2 rounded-lg font-medium transition-colors " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 " +
    (size === "hero" ? "px-5 py-3 min-h-12 text-sm" : "px-3 py-2 min-h-11 text-sm");

  return (
    <>
      {WA_DIGITS && (
        <a
          href={`https://wa.me/${WA_DIGITS}?text=${WA_TEXT}`}
          target="_blank"
          rel="noopener noreferrer"
          className={`${base} bg-green-600 hover:bg-green-500 text-white`}
        >
          <MessageCircle size={16} />
          {tr.nav.whatsapp}
        </a>
      )}
      <a
        href={`tel:${PHONE.replace(/[^\d+]/g, "")}`}
        className={`${base} border border-white/15 text-gray-200 hover:text-white hover:border-blue-500/50 hover:bg-blue-500/10`}
      >
        <Phone size={16} />
        <span dir="ltr">{size === "hero" ? PHONE : tr.nav.call}</span>
      </a>
    </>
  );
}
