import type { Metadata } from "next";
import { cookies } from "next/headers";
import MoldsRegister from "@/components/dashboard/molds-register";
import { LANG_COOKIE, langFromValue } from "@/lib/lang-cookie";

// The one heading this page shows — reused for the tab title so they can't drift.
const TITLE = { en: "Molds Register", ar: "حصر الاسطمبات" };

// A server component (unlike the rest of the dashboard), so the tab title can
// come from real metadata; the root layout's template appends the brand suffix.
export async function generateMetadata(): Promise<Metadata> {
  const lang = langFromValue((await cookies()).get(LANG_COOKIE)?.value) ?? "ar"; // no stored choice -> Arabic (owner's word, 2026-08-28)
  return { title: TITLE[lang] };
}

// Since 2026-09-04 the register reads «الرئيسي» itself (GET /api/molds) rather
// than the «الاسطمبات» view, so it can show the MOULD NUMBER even when the
// sheet keeps it in the notes column — and the worker role can open it.
export default function MoldsPage() {
  return (
    <MoldsRegister
      title={TITLE}
      subtitle={{ en: "Every mould and its number — live from Master", ar: "كل اسطمبة ورقمها — مباشرةً من الرئيسي" }}
    />
  );
}
