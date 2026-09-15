/**
 * The company's public contact facts — ONE definition, owner-supplied
 * 2026-09-15. Deliberately NOT env: the env copy (NEXT_PUBLIC_CONTACT_PHONE)
 * had drifted to the second number while the ads campaign sent traffic to the
 * site. These are public on every business card; there is nothing to hide.
 *
 * Name is «إتقان» with the hamza — never «اتقان», never ITKAN.
 * No certifications exist — never imply any.
 */

export const COMPANY = {
  nameEn: "Itqan",
  nameAr: "إتقان",
  founded: 2005,
  /** Primary: calls AND WhatsApp. */
  phone: { display: "+20 106 980 0643", tel: "+201069800643", wa: "201069800643" },
  phone2: { display: "+20 101 329 8179", tel: "+201013298179" },
  email: "abdelrhmanfouda@etqaneg.com",
  mapUrl: "https://maps.app.goo.gl/1mkwqngykxobGyxJ6",
} as const;

export const WA_TEXT = "السلام عليكم، عندي استفسار عن تصنيع قطعة بلاستيك";

export const WHATSAPP_URL = `https://wa.me/${COMPANY.phone.wa}?text=${encodeURIComponent(WA_TEXT)}`;
