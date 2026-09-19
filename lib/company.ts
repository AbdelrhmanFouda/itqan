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
  /**
   * The ONE published line — calls AND WhatsApp, answered by staff.
   * The owner's own two numbers (…0643, …8179) were RETIRED from the site on
   * 2026-09-16 after the Performance Max campaign filled them with junk calls.
   * Do not put a personal number back here.
   */
  phone: { display: "+20 105 083 4098", tel: "+201050834098", wa: "201050834098" },
  email: "abdelrhmanfouda@etqaneg.com",
  mapUrl: "https://maps.app.goo.gl/1mkwqngykxobGyxJ6",
} as const;

export const WA_TEXT = "السلام عليكم، عندي استفسار عن تصنيع قطعة بلاستيك";

export const WHATSAPP_URL = `https://wa.me/${COMPANY.phone.wa}?text=${encodeURIComponent(WA_TEXT)}`;
