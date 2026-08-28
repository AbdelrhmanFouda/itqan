import type { Metadata } from "next";
import { cookies } from "next/headers";
import SheetSection from "@/components/dashboard/SheetSection";
import { LANG_COOKIE, langFromValue } from "@/lib/lang-cookie";

// The one heading this page shows — reused for the tab title so they can't drift.
const TITLE = { en: "Products", ar: "المنتجات" };

// A server component (unlike the rest of the dashboard), so the tab title can
// come from real metadata; the root layout's template appends the brand suffix.
export async function generateMetadata(): Promise<Metadata> {
  const lang = langFromValue((await cookies()).get(LANG_COOKIE)?.value) ?? "en";
  return { title: TITLE[lang] };
}

export default function ProductsPage() {
  return (
    <SheetSection
      entity="products"
      title={TITLE}
      subtitle={{ en: "Live from your products sheet", ar: "مباشرةً من جدول المنتجات" }}
    />
  );
}
