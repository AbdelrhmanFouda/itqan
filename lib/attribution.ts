/**
 * Where an enquiry came from — added 2026-09-15, the day a paid Google Ads
 * campaign started sending traffic. Attribution cannot be reconstructed after
 * the fact, so it is captured on the FIRST landing of the session and kept in
 * sessionStorage: a visitor who lands on /?gclid=… and then scrolls, switches
 * language or reloads still submits as google.
 *
 * `source` is a FIXED vocabulary, lowercase, never renamed — reports group on
 * it. The client only ever derives google / facebook / direct; whatsapp and
 * referral exist for leads entered by other routes.
 */

export const SOURCES = ["facebook", "google", "whatsapp", "referral", "direct"] as const;
export type Source = (typeof SOURCES)[number];

export type Attribution = {
  source: Source;
  utm_source: string;
  utm_campaign: string;
  gclid: string;
  fbclid: string;
  landing_path: string;
};

export function isSource(v: unknown): v is Source {
  return typeof v === "string" && (SOURCES as readonly string[]).includes(v);
}

const cap = (v: string | null) => (v ?? "").trim().slice(0, 200);

/** Pure: a landing URL's search + pathname → attribution. */
export function deriveAttribution(search: string, pathname: string): Attribution {
  const q = new URLSearchParams(search);
  const utmSource = cap(q.get("utm_source"));
  const gclid = cap(q.get("gclid"));
  const fbclid = cap(q.get("fbclid"));
  const u = utmSource.toLowerCase();
  const source: Source =
    gclid || u === "google" ? "google" : fbclid || u === "facebook" ? "facebook" : "direct";
  return {
    source,
    utm_source: utmSource,
    utm_campaign: cap(q.get("utm_campaign")),
    gclid,
    fbclid,
    landing_path: (pathname + search).slice(0, 300),
  };
}

const KEY = "itqan.attribution";

/**
 * Browser only. Keeps the first landing of the session — unless a LATER landing
 * carries an ad marker and the stored one did not (someone browsed, then came
 * back through an ad in the same tab: the ad is the better answer).
 */
export function captureAttribution(): Attribution | null {
  try {
    const now = deriveAttribution(window.location.search, window.location.pathname);
    const raw = sessionStorage.getItem(KEY);
    const stored = raw ? (JSON.parse(raw) as Attribution) : null;
    if (stored && isSource(stored.source) && !(stored.source === "direct" && now.source !== "direct")) {
      return stored;
    }
    sessionStorage.setItem(KEY, JSON.stringify(now));
    return now;
  } catch {
    return null;
  }
}
