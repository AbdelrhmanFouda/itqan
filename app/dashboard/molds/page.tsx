import type { Metadata } from "next";
import { cookies } from "next/headers";
import SheetSection from "@/components/dashboard/SheetSection";
import { LANG_COOKIE, langFromValue } from "@/lib/lang-cookie";

// The one heading this page shows — reused for the tab title so they can't drift.
const TITLE = { en: "Molds Register", ar: "حصر الاسطمبات" };

// A server component (unlike the rest of the dashboard), so the tab title can
// come from real metadata; the root layout's template appends the brand suffix.
export async function generateMetadata(): Promise<Metadata> {
  const lang = langFromValue((await cookies()).get(LANG_COOKIE)?.value) ?? "en";
  return { title: TITLE[lang] };
}

export default function MoldsPage() {
  return (
    <SheetSection
      entity="molds"
      title={TITLE}
      subtitle={{ en: "Live from your molds sheet", ar: "مباشرةً من جدول الاسطمبات" }}
    />
  );
}
