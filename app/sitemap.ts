import type { MetadataRoute } from "next";

// /sitemap.xml was a 404 until 2026-08-27. One public page today; add entries
// here if the marketing site ever grows real routes.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://itqan-taupe.vercel.app/",
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 1,
    },
  ];
}
