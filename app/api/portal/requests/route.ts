import { NextRequest, NextResponse, after } from "next/server";
import { appendRecord, ensureTab, getRecords } from "@/lib/sheets";
import { requireCustomer, type CustomerIdentity } from "@/lib/api-guard";
import { clientKey } from "@/lib/customer-link";
import { masterRowForPick, nameKey } from "@/lib/master-lookup";
import { ISO_DAY, parseQuantity } from "@/lib/work-orders";
import { todayIso } from "@/lib/dates";
import { notify, line } from "@/lib/notify";
import { loadRequests, ownRequests } from "@/lib/customer-requests-data";
import {
  cairoStamp, cairoYear, findReplay, nextReqId, pieceWeightG, qtyKgFor, requestUnit,
  requestStateToSheet, REQUEST_HEADERS, REQUEST_TAB, MAX_OPEN_REQUESTS,
  MAX_SUBMITS_PER_WINDOW, SUBMIT_WINDOW_MS, NOTE_MAX, PRODUCT_MAX,
} from "@/lib/customer-requests";

/**
 * A customer asks for something to be made.
 *
 * NOTHING is written to «أوامر العمل» here, and that is the whole reason this
 * tab exists: a row there is an OPEN ORDER the moment it exists — counted in
 * the open-orders tile, offered a one-tap «ابدأ التشغيل», and subtracted from
 * «المتاح» on /dashboard/stock before anybody agreed to make it. A request
 * becomes a work order on /dashboard/requests, by a human tap.
 *
 * Four things protect the tab, in this order:
 *
 *  1. THE GUARD, first, before the body is read. The client link comes off the
 *     caller's own document; the body may not name a client and does not.
 *  2. A PER-ACCOUNT LIMITER (10/hour, in memory, therefore per instance — the
 *     shape /api/contact uses for IPs, and best-effort for the same reason).
 *  3. THE OPEN CAP: five rows in «قيد المراجعة» and no more, checked on the
 *     fresh read this route already performs, so it cannot be dodged by
 *     hitting a different instance.
 *  4. THE REPLAY KEY. The bridge is AT-LEAST-ONCE — a write that answered
 *     failed may have landed — so the same product, number, unit and wanted
 *     date from the same account within a quarter of an hour answers with the
 *     reference number that is already in the tab and writes nothing.
 *
 * The product is re-resolved against «الرئيسي» on a FRESH read and must belong
 * to this customer. `masterRow` from the form is a HINT that tells two Master
 * rows with the same name apart; it is never trusted on its own.
 */

/* ------------------------- the per-account limiter ------------------------ */

const hits = new Map<string, number[]>();

function rateLimited(uid: string): boolean {
  const now = Date.now();
  const list = (hits.get(uid) ?? []).filter((t) => now - t < SUBMIT_WINDOW_MS);
  if (list.length >= MAX_SUBMITS_PER_WINDOW) { hits.set(uid, list); return true; }
  list.push(now);
  hits.set(uid, list);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= SUBMIT_WINDOW_MS)) hits.delete(k);
  }
  return false;
}

/* ------------------------------- the route -------------------------------- */

const s = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

/** The «العملاء» row this customer speaks for, for the product's client cell. */
function linkFor(customer: CustomerIdentity, masterClient: string) {
  const want = clientKey(masterClient);
  for (const c of customer.clients) {
    if (clientKey(c.name) === want) return c;
    if ((c.aliases ?? []).some((a) => clientKey(a) === want)) return c;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const g = await requireCustomer(req);
  if ("deny" in g) return g.deny;
  const customer = g.customer;
  if (rateLimited(customer.uid)) {
    return NextResponse.json({ ok: false, reason: "rate_limited" }, { status: 429 });
  }

  const bad = (reason: string, status = 400) => NextResponse.json({ ok: false, reason }, { status });
  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return bad("bad_request");
  }

  const productName = s(b.product, PRODUCT_MAX);
  if (!productName) return bad("missing_product");
  const wantedDate = s(b.wantedDate, 20);
  if (!ISO_DAY.test(wantedDate)) return bad("missing_date");
  // A date already past is not a request anybody can meet. The form refuses it
  // before the button is enabled; this is the same rule, server-side.
  if (wantedDate < todayIso()) return bad("past_date");
  const qty = parseQuantity(s(b.qtyAsked, 30));
  if (qty.value === null || !(qty.value > 0)) return bad("bad_qty");
  const note = s(b.note, NOTE_MAX);

  try {
    // The product, on a FRESH read: a colleague may have inserted rows in
    // «الرئيسي» since the form loaded, which moves a product without renaming
    // it. The tapped row wins while it still carries the name.
    const tapped = Number(b.masterRow) > 0 ? Number(b.masterRow) : undefined;
    const master = await getRecords("master", { fresh: true });
    const m = masterRowForPick(master.records, productName, tapped);
    // Not in Master, or in Master under ANOTHER company: the same answer, and
    // deliberately so — «this is not one of your products» tells a caller
    // nothing about what else exists.
    if (!m) return bad("unknown_product", 404);
    const link = linkFor(customer, m.client || "");
    if (!link) return bad("unknown_product", 404);

    const unit = requestUnit(m.weight);
    const grams = pieceWeightG(m.weight);
    const qtyKg = qtyKgFor(qty.value, unit, grams);

    // The tab as it is RIGHT NOW: the reference number, the open cap and the
    // replay check all read the same copy.
    const { rows } = await loadRequests({ fresh: true });
    const mine = ownRequests(rows, customer.clientKeys);

    const stamp = cairoStamp();
    const replay = findReplay(
      mine.map((r) => ({
        reqId: r.reqId, productKey: r.productKey, qtyAsked: r.qtyAsked,
        unit: r.unit, wantedDate: r.wantedDate, submittedAt: r.submittedAt,
      })),
      { productKey: nameKey(m.name || productName), qtyAsked: qty.value, unit, wantedDate },
      stamp,
    );
    if (replay) return NextResponse.json({ ok: true, reqId: replay, replay: true });

    const open = mine.filter((r) => r.state === "pending").length;
    if (open >= MAX_OPEN_REQUESTS) return bad("too_many_open", 429);

    const reqId = nextReqId(rows.map((r) => r.reqId), cairoYear());
    const values: Record<string, string> = {
      reqId,
      submittedAt: stamp,
      clientNo: link.no > 0 ? String(link.no) : "",
      // The owner-approved «العملاء» spelling — never what the customer typed
      // at sign-up, and never a name from the request.
      client: link.name,
      product: m.name || productName,
      masterRow: String(m.row),
      qtyAsked: String(qty.value),
      unit,
      qtyKg: String(qtyKg),
      wantedDate,
      note,
      state: requestStateToSheet("pending"),
      rejectReason: "",
      jobCode: "",
      decidedBy: "",
      decidedAt: "",
    };

    // LAZY TAB CREATION: append first, and only on a `no_tab` answer create
    // the tab and append once more — the same shape `logIssue` uses, and the
    // reason the owner never has to prepare anything before the first request.
    let res = await appendRecord("customerRequests", values);
    if (!res.ok && res.reason === "no_tab") {
      const made = await ensureTab(REQUEST_TAB, REQUEST_HEADERS);
      if (!made.ok) {
        console.error(`[portal/requests] could not create «${REQUEST_TAB}»: ${made.reason}`);
        return NextResponse.json({ ok: false, reason: "save_failed" }, { status: 503 });
      }
      res = await appendRecord("customerRequests", values);
    }
    if (!res.ok) {
      console.error(`[portal/requests] append failed: ${res.reason}`);
      return NextResponse.json({ ok: false, reason: "save_failed" }, { status: 503 });
    }

    // The owner learns about it at once — decision 7: the factory is told by
    // email, the customer is told by the portal. After the sheet write,
    // bounded, and unable to fail the submit (a request that IS in the tab
    // must never be reported as failed because an email did not leave).
    after(() =>
      notify(
        `طلب جديد من عميل — ${reqId}`,
        line("العميل", link.name) + line("المنتج", values.product) +
          line("العدد المطلوب", `${values.qtyAsked} ${unit}`) +
          line("الكمية بالكيلو", String(qtyKg)) +
          line("التاريخ المطلوب", wantedDate) + line("ملاحظات", note) +
          line("الحساب", customer.email),
        "portal/requests",
      ),
    );

    return NextResponse.json({ ok: true, reqId });
  } catch (err) {
    console.error("[portal/requests]", err);
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}
