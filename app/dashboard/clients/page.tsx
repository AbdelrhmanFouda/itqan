import SheetSection from "@/components/dashboard/SheetSection";

export default function ClientsPage() {
  return (
    <SheetSection
      entity="clients"
      title={{ en: "Clients", ar: "العملاء" }}
      subtitle={{ en: "Live from your clients sheet", ar: "مباشرةً من جدول العملاء" }}
      columns={4}
    />
  );
}
