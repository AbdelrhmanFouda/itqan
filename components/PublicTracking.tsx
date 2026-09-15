"use client";
import { useEffect } from "react";
import Script from "next/script";
import { captureAttribution } from "@/lib/attribution";
import { ADS_ID } from "@/lib/ads";

/**
 * Mounted on the public page only. Records the first landing's attribution
 * (see lib/attribution.ts) and, when NEXT_PUBLIC_GOOGLE_ADS_ID is set, loads
 * gtag so conversions can fire (lib/ads.ts).
 */
export default function PublicTracking() {
  useEffect(() => {
    captureAttribution();
  }, []);

  if (!ADS_ID) return null;
  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${ADS_ID}`} strategy="afterInteractive" />
      <Script id="gtag-init" strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${ADS_ID}');`}
      </Script>
    </>
  );
}
