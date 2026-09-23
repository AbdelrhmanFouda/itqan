import type { MetadataRoute } from "next";

// Keep the internal system + auth pages out of search engines; the public
// marketing pages remain indexable.
//
// /portal joined the list on 2026-09-23 with the customer portal. It is a
// sign-in wall, so a crawler finds nothing there — but an indexed sign-in page
// invites credential-stuffing traffic, and the portal's own pages carry a
// buyer's order history behind it. Pinned by tests/portal-access.test.ts.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/dashboard", "/api/", "/login", "/portal"] }],
  };
}
