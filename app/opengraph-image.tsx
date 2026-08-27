import { ImageResponse } from "next/og";

/**
 * The share-preview card (og:image + twitter:image, wired automatically by the
 * App Router). Generated, not a photo: the only product photos that exist are
 * demo assets from an earlier iteration, and shipping those as "our factory"
 * would be a lie. Latin-only text on purpose — satori renders Arabic as tofu
 * without an embedded Arabic font, and a broken «إتقان» is worse than none.
 * The og:title/description carry the Arabic instead.
 */

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Itqan — plastic injection molding in Egypt";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #030712 0%, #0b1a3a 100%)",
          color: "#ffffff",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 28,
          }}
        >
          <div
            style={{
              width: 96,
              height: 96,
              borderRadius: 24,
              background: "#2563eb",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 56,
              fontWeight: 700,
            }}
          >
            IQ
          </div>
          <div style={{ display: "flex", fontSize: 96, fontWeight: 700, letterSpacing: -2 }}>
            ITQAN
          </div>
        </div>
        <div style={{ display: "flex", marginTop: 28, fontSize: 34, color: "#93c5fd" }}>
          Plastic Injection Molding · Fan Counterweights · CNC Molds
        </div>
        <div style={{ display: "flex", marginTop: 12, fontSize: 28, color: "#6b7280" }}>
          Egypt — Contract Manufacturing
        </div>
      </div>
    ),
    size,
  );
}
