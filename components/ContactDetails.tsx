"use client";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import { Phone, Mail, MapPin, Clock } from "lucide-react";
import { COMPANY } from "@/lib/company";
import { trackConversion } from "@/lib/ads";

/**
 * Both phones, email, address + map, hours — used by the Contact section
 * (variant "card") and the footer ("footer"). Values from lib/company.ts.
 */
export default function ContactDetails({ variant = "card" }: { variant?: "card" | "footer" }) {
  const { lang } = useLang();
  const d = t[lang].contact.details;
  const isAr = lang === "ar";
  const footer = variant === "footer";

  const link = "hover:text-blue-400 transition-colors underline-offset-4 hover:underline";
  const row = "flex items-start gap-3";
  const icon = footer ? "text-gray-500 mt-0.5 shrink-0" : "text-blue-400 mt-0.5 shrink-0";

  return (
    <div
      dir={isAr ? "rtl" : "ltr"}
      className={
        footer
          ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm text-gray-400 text-start"
          : "mt-8 grid gap-4 sm:grid-cols-2 rounded-2xl border border-white/8 bg-gray-950/60 p-5 text-sm text-gray-300 text-start"
      }
    >
      <div className={row}>
        <Phone size={16} className={icon} />
        <div>
          <div className="text-xs text-gray-500 mb-1">{d.phones}</div>
          <a href={`tel:${COMPANY.phone.tel}`} onClick={() => trackConversion("call")} className={`${link} block min-h-7`} dir="ltr">
            {COMPANY.phone.display}
          </a>
          <a href={`tel:${COMPANY.phone2.tel}`} onClick={() => trackConversion("call")} className={`${link} block min-h-7`} dir="ltr">
            {COMPANY.phone2.display}
          </a>
        </div>
      </div>
      <div className={row}>
        <Mail size={16} className={icon} />
        <div className="min-w-0">
          <div className="text-xs text-gray-500 mb-1">{d.email}</div>
          <a href={`mailto:${COMPANY.email}`} className={`${link} break-all`} dir="ltr">
            {COMPANY.email}
          </a>
        </div>
      </div>
      <div className={row}>
        <MapPin size={16} className={icon} />
        <div>
          <div>{d.address}</div>
          <a href={COMPANY.mapUrl} target="_blank" rel="noopener noreferrer" className={`${link} text-blue-400 inline-block min-h-7`}>
            {d.map}
          </a>
        </div>
      </div>
      <div className={row}>
        <Clock size={16} className={icon} />
        <div>
          <div className="text-xs text-gray-500 mb-1">{d.hoursTitle}</div>
          {d.hours.map((h) => (
            <div key={h}>{h}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
