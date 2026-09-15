/**
 * Google Ads conversion tracking for the PUBLIC site only (loaded from
 * app/page.tsx, never the dashboard). Everything is inert until the owner sets
 * the env below in Vercel and redeploys — NEXT_PUBLIC_* is inlined at build:
 *
 *   NEXT_PUBLIC_GOOGLE_ADS_ID           "AW-123456789"
 *   NEXT_PUBLIC_GOOGLE_ADS_LABEL_WHATSAPP  conversion label, e.g. "AbC-D_efG123"
 *   NEXT_PUBLIC_GOOGLE_ADS_LABEL_CALL
 *   NEXT_PUBLIC_GOOGLE_ADS_LABEL_FORM
 *
 * A missing label simply skips that conversion.
 */

export const ADS_ID = (process.env.NEXT_PUBLIC_GOOGLE_ADS_ID ?? "").trim();

const LABELS = {
  whatsapp: (process.env.NEXT_PUBLIC_GOOGLE_ADS_LABEL_WHATSAPP ?? "").trim(),
  call: (process.env.NEXT_PUBLIC_GOOGLE_ADS_LABEL_CALL ?? "").trim(),
  form: (process.env.NEXT_PUBLIC_GOOGLE_ADS_LABEL_FORM ?? "").trim(),
};

type Gtag = (...args: unknown[]) => void;

export function trackConversion(kind: keyof typeof LABELS) {
  try {
    const label = LABELS[kind];
    const gtag = (window as unknown as { gtag?: Gtag }).gtag;
    if (!ADS_ID || !label || !gtag) return;
    gtag("event", "conversion", { send_to: `${ADS_ID}/${label}` });
  } catch {
    /* tracking must never break a click */
  }
}
