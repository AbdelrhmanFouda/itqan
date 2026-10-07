import { NextRequest, NextResponse } from "next/server";
import { getStorageData, storageConfigured } from "@/lib/storage";
import { requireCustomer } from "@/lib/api-guard";
import { buildCustomerStock } from "@/lib/customer-stock";

/**
 * «المخزون» — the stock the factory holds for THIS customer.
 *
 * The same shape as the orders route: the guard reads the link off the
 * caller's own `customers/{uid}` document, nothing in the request names a
 * client (the handler reads no query string and no body, so there is nothing
 * to tamper with), and the answer is built by ONE function —
 * `buildCustomerStock` in lib/customer-stock.ts — which filters «مخزن اتقان»
 * on «العميل» with the exact-key rule and returns a pinned whitelist of eleven
 * keys per item. A storage place, a loss figure, a movement number, a note, a
 * beneficiary and every other customer's row stay on the server.
 *
 * READ-ONLY by construction: this file imports the storage READER and no
 * writer, and it has no POST.
 *
 * Freshness is stated, never claimed. `getStorageData()` serves a copy of any
 * age up to its stale window at once and refreshes behind, so the answer
 * carries how old it is (`dataAgeMs`) and whether the bridge failed to answer
 * this time (`stale`); the page prints the age and refetches. A read with no
 * copy at all is a 503 — the page keeps what it last showed.
 */
export async function GET(req: NextRequest) {
  const g = await requireCustomer(req);
  if ("deny" in g) return g.deny;
  const keys = g.customer.clientKeys;
  // Never cached: the answer is scoped to ONE account's link, and a
  // revocation or a corrected link must take effect on the very next call.
  const headers = { "Cache-Control": "no-store" };
  try {
    if (!storageConfigured()) {
      return NextResponse.json({ ok: true, lines: [], meta: { dataAgeMs: 0, stale: false } }, { headers });
    }
    const data = await getStorageData();
    if (!data.ok) return NextResponse.json({ ok: false, error: "read_failed" }, { status: 503 });

    const lines = buildCustomerStock({
      balance: data.balance,
      inLog: data.inLog,
      outLog: data.outLog,
      weights: data.lists.weights,
      clientKeys: keys,
    });

    return NextResponse.json(
      { ok: true, lines, meta: { dataAgeMs: Math.max(0, Date.now() - data.readAt), stale: data.stale } },
      { headers },
    );
  } catch (err) {
    console.error("[portal/stock]", err);
    return NextResponse.json({ ok: false, error: "read_failed" }, { status: 503 });
  }
}
