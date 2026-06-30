import SheetSection from "@/components/dashboard/SheetSection";

export default function ProductsPage() {
  return (
    <SheetSection
      entity="products"
      title={{ en: "Products", ar: "المنتجات" }}
      subtitle={{ en: "Live from your products sheet", ar: "مباشرةً من جدول المنتجات" }}
    />
  );
}
