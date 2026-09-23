import { NextRequest, NextResponse } from "next/server";
import { getRecords } from "@/lib/sheets";
import { requireCustomer } from "@/lib/api-guard";
import { belongsToCustomer } from "@/lib/customer-link";
import { nameKey } from "@/lib/master-lookup";
import { pieceWeightG, requestUnit } from "@/lib/customer-requests";

/**
 * The products THIS customer may ask for — «الرئيسي» filtered by the link on
 * their own `customers/{uid}` document.
 *
 * Four fields and no more: the name, the Master row the person tapped (a hint
 * the submit re-resolves by name on a fresh read), the unit they will type in,
 * and the piece weight behind that unit so the form can show «≈ 62.5 كجم»
 * while they type. Everything else Master holds about a product — the cycle
 * time, the cavity count, the material, the possible defects, the mould number
 * — is the FACTORY's knowledge, not the buyer's, and none of it is serialised
 * here. /api/sheet/products and /api/molds are guarded (2026-09-23) precisely
 * so this is the only door.
 *
 * The filter is `belongsToCustomer` on Master's «العميل»: exact after digit,
 * case and whitespace folding, against the canonical name and the aliases the
 * owner approved. Never a substring, never an Arabic search fold — a product
 * list is where a wrong match would first show itself.
 */
export async function GET(req: NextRequest) {
  const g = await requireCustomer(req);
  if ("deny" in g) return g.deny;
  const keys = g.customer.clientKeys;
  try {
    const master = await getRecords("master");
    const seen = new Set<string>();
    const products: { name: string; masterRow: number; unit: string; pieceWeightG: number }[] = [];
    for (const m of master.records) {
      if (!belongsToCustomer(m.client, keys)) continue;
      const name = (m.name || "").trim();
      const key = nameKey(name);
      // A name Master holds twice for the SAME customer would otherwise appear
      // twice in a list where the two entries are indistinguishable. First row
      // wins, as the sheet's own VLOOKUP does; the submit re-resolves by name.
      if (!key || seen.has(key)) continue;
      seen.add(key);
      products.push({
        name,
        masterRow: m.row,
        unit: requestUnit(m.weight),
        pieceWeightG: pieceWeightG(m.weight),
      });
    }
    products.sort((a, b) => a.name.localeCompare(b.name, "ar"));
    return NextResponse.json(
      { ok: true, products, meta: { dataAgeMs: Math.max(0, Date.now() - master.readAt) } },
      // Never cached: the response is scoped to ONE account's link, and a
      // revocation must take effect on the very next call.
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[portal/products]", err);
    return NextResponse.json({ ok: false, error: "read_failed" }, { status: 503 });
  }
}
