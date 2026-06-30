import SheetSection from "@/components/dashboard/SheetSection";

export default function MoldsPage() {
  return (
    <SheetSection
      entity="molds"
      title={{ en: "Molds Register", ar: "حصر الاسطمبات" }}
      subtitle={{ en: "Live from your molds sheet", ar: "مباشرةً من جدول الاسطمبات" }}
    />
  );
}
