import type { MetadataRoute } from "next";

// Keep the internal system + auth pages out of search engines; the public
// marketing pages remain indexable.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/dashboard", "/api/", "/login"] }],
  };
}
