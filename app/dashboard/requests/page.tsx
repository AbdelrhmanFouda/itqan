"use client";
import { usePageTitle } from "@/components/dashboard/use-page-title";
/**
 * «طلبات العملاء» — where a customer's request becomes a work order.
 *
 * One screen, one decision per row. It is the staff half of the portal, and
 * the two things it must never do are guess and lie:
 *
 *  - the preview is built by the SAME server code that performs the write
 *    (lib/work-orders-write.ts `planWorkOrder`), so what is on the screen is
 *    what the sheet will receive. Nothing is written until «موافقة» is tapped;
 *  - the KILOGRAMS are editable, and that is the point of the screen. They are
 *    derived from «الرئيسي»'s free-text weight cell (which held «21.6 ALL
 *    pieces» until 13 Sep 2026), and this is the last place a mis-parsed
 *    standard can be caught before material is bought against it;
 *  - a product name «الرئيسي» holds twice stops the form and asks which row —
 *    one live duplicate is shared by two different clients, which is precisely
 *    a product a customer could order;
 *  - the delivery date defaults to the date the customer asked for. Countering
 *    it here is what the customer then sees on their own card, with their date
 *    struck through — hiding that difference is how a phone call starts.
 *
 * The at-least-once bridge shows through in one place, deliberately: if the
 * work order landed and the stamp on the request did not, the answer names the
 * code and the screen says so in plain Arabic. The next tap re-stamps only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "@/context/LangContext";
import { cp } from "@/lib/i18n.portal";
import { pd } from "@/lib/i18n.prod";
import { Check, Inbox, RefreshCw, Search, X } from "lucide-react";
import {
  Pill, Field, inputCls, Btn, Modal, EmptyState, Spinner, LoadError, StatTile, iconBtnCls,
} from "@/components/dashboard/ui";
import type { Tone } from "@/lib/prod-meta";
import { authedFetch } from "@/lib/authed-fetch";
import { ageLabel, fill, fmtNum } from "@/lib/format";
import { timedJson } from "@/components/dashboard/last-seen";
import { useRemembered } from "@/components/dashboard/use-remembered";
import { matchesTerms, searchTerms } from "@/lib/storage-filter";
import { UNIT_PIECES } from "@/lib/customer-requests";

type ReqRow = {
  row: number; reqId: string; submittedAt: string; clientNo: string; client: string;
  product: string; productKey: string; masterRow: number; qtyAsked: number; unit: string;
  qtyKg: number; wantedDate: string; note: string; state: string; rejectReason: string;
  jobCode: string; decidedBy: string; decidedAt: string;
};
type Data = {
  requests: ReqRow[];
  pending: number;
  /** Age of the sheet copy behind the list; absent on a device snapshot. */
  meta?: { dataAgeMs: number };
};
type Candidate = { masterRow: number; client: string; product: string; moldNumber: string };
type Preview = {
  ok: boolean;
  reason?: string;
  reqId: string;
  state: string;
  qtyAsked: number;
  unit: string;
  wantedDate: string;
  note: string;
  client: string;
  requestClient: string;
  code: string;
  product: string;
  moldCode: string;
  masterRow: number;
  qtyKg: number;
  startDate: string;
  dueDate: string;
  machine: string;
  duplicates: Candidate[];
  existingCode: string;
};

const LAST_KEY = "itqan.requests.last";
/** Past this the page says «الأرقام من قبل …» and refetches once on its own. */
const STALE_AFTER_MS = 60_000;
type Tile = "" | "pending" | "accepted" | "rejected" | "cancelled";

const stateTone = (state: string): Tone =>
  state === "accepted" ? "green"
    : state === "rejected" ? "red"
      : state === "cancelled" ? "gray"
        : state === "pending" ? "amber" : "blue";

export default function RequestsPage() {
  const { lang } = useLang();
  const p = cp[lang].staff.reqs;
  const c = pd[lang].common;
  const isAr = lang === "ar";
  usePageTitle(p.title);

  const [tile, setTile] = useState<Tile>("");
  const [search, setSearch] = useState("");
  // The open review: the row being decided, its preview, and what is typed.
  const [openReq, setOpenReq] = useState<ReqRow | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [form, setForm] = useState({ qtyKg: "", startDate: "", dueDate: "" });
  const [pickedRow, setPickedRow] = useState(0);
  const [rejecting, setRejecting] = useState(false);
  const [why, setWhy] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");

  const loadRef = useRef<() => Promise<void>>(async () => {});
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const staleRefetches = useRef(0);
  // Snapshot → paint → bounded read → keep what is on screen when it fails.
  const { data, loading, failed: error, reload: load } = useRemembered<Data>({
    key: LAST_KEY,
    read: () => timedJson<Data>(authedFetch, "/api/requests"),
    valid: (snap) => Array.isArray(snap?.requests),
    // A snapshot carries no server-side age — the spinner is its honest hint.
    hydrate: (snap) => ({ ...snap, meta: undefined }),
    onLoaded: (json) => {
      const age = json.meta?.dataAgeMs ?? 0;
      if (age <= STALE_AFTER_MS) staleRefetches.current = 0;
      else if (!refetchTimer.current && staleRefetches.current < 2) {
        staleRefetches.current += 1;
        refetchTimer.current = setTimeout(() => { refetchTimer.current = null; loadRef.current(); }, 8000);
      }
    },
  });
  loadRef.current = load;
  useEffect(() => () => { if (refetchTimer.current) clearTimeout(refetchTimer.current); }, []);

  /* -------------------------------- the list -------------------------------- */

  const rows = useMemo(() => data?.requests ?? [], [data]);
  const counts = useMemo(() => ({
    pending: rows.filter((r) => r.state === "pending").length,
    accepted: rows.filter((r) => r.state === "accepted").length,
    rejected: rows.filter((r) => r.state === "rejected").length,
    cancelled: rows.filter((r) => r.state === "cancelled").length,
  }), [rows]);
  const terms = useMemo(() => searchTerms(search), [search]);
  const shown = useMemo(() => {
    let list = rows;
    if (tile) list = list.filter((r) => r.state === tile);
    if (terms.length) {
      list = list.filter((r) => matchesTerms([r.reqId, r.client, r.product, r.jobCode, r.note], terms));
    }
    return list;
  }, [rows, tile, terms]);
  const filtered = !!(tile || terms.length);

  // A state the sheet holds but the app does not know passes through on read —
  // it must render as itself, not as one of the four.
  const stateLabel = useCallback(
    (state: string) => (p.states as Record<string, string>)[state] ?? state,
    [p],
  );
  const errText = useCallback(
    (reason: string, vars: Record<string, string | number> = {}) =>
      fill((p.errors as Record<string, string>)[reason] ?? p.errors.generic, vars),
    [p],
  );

  /* ------------------------------ the review -------------------------------- */

  const openReview = useCallback(async (r: ReqRow, masterRow = 0) => {
    setOpenReq(r);
    setRejecting(false);
    setWhy("");
    setSaveErr("");
    setPreview(null);
    setPickedRow(masterRow);
    setPreviewing(true);
    const url = `/api/requests/${encodeURIComponent(r.reqId)}/preview${masterRow ? `?masterRow=${masterRow}` : ""}`;
    const res = await authedFetch(url, { signal: AbortSignal.timeout(90_000) }).catch(() => null);
    setPreviewing(false);
    if (!res) { setSaveErr(p.preview.failed); return; }
    const json = (await res.json().catch(() => null)) as Preview | null;
    if (!json) { setSaveErr(p.preview.failed); return; }
    setPreview(json);
    if (json.ok) {
      setForm({
        qtyKg: json.qtyKg > 0 ? String(json.qtyKg) : "",
        startDate: json.startDate,
        dueDate: json.dueDate,
      });
    } else if (json.reason !== "duplicate_product") {
      setSaveErr(errText(String(json.reason ?? "")));
    }
  }, [p, errText]);

  function close() {
    setOpenReq(null);
    setPreview(null);
    setRejecting(false);
    setSaveErr("");
  }

  const kgTyped = Number(form.qtyKg) || 0;
  const datesBad = !!form.startDate && !!form.dueDate && form.dueDate < form.startDate;
  const duplicates = preview?.duplicates ?? [];
  const needsPick = duplicates.length > 1 && !pickedRow;
  const canApprove = !!preview && kgTyped > 0 && !!form.dueDate && !datesBad && !needsPick && !saving;

  async function approve() {
    if (!openReq || !canApprove) return;
    setSaving(true);
    setSaveErr("");
    const res = await authedFetch(`/api/requests/${encodeURIComponent(openReq.reqId)}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        qtyKg: form.qtyKg,
        startDate: form.startDate,
        dueDate: form.dueDate,
        ...(pickedRow ? { masterRow: pickedRow } : {}),
      }),
      signal: AbortSignal.timeout(90_000),
    }).catch(() => null);
    setSaving(false);
    if (!res || !res.ok) {
      const body = res ? ((await res.json().catch(() => ({}))) as Record<string, unknown>) : {};
      const reason = String(body.reason ?? "");
      setSaveErr(errText(reason, { code: String(body.code ?? "") }));
      // «الرئيسي» answered with candidates — show them instead of a message.
      if (reason === "duplicate_product" && Array.isArray(body.duplicates)) {
        setPreview((v) => (v ? { ...v, duplicates: body.duplicates as Candidate[] } : v));
        setPickedRow(0);
      }
      // The bridge is at-least-once: whatever the answer, the queue is read
      // again before anybody can tap twice.
      load();
      return;
    }
    close();
    load();
  }

  async function reject() {
    if (!openReq || !why.trim() || saving) return;
    setSaving(true);
    setSaveErr("");
    const res = await authedFetch(`/api/requests/${encodeURIComponent(openReq.reqId)}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: why.trim() }),
      signal: AbortSignal.timeout(90_000),
    }).catch(() => null);
    setSaving(false);
    if (!res || !res.ok) {
      const body = res ? ((await res.json().catch(() => ({}))) as Record<string, unknown>) : {};
      setSaveErr(errText(String(body.reason ?? "")));
      load();
      return;
    }
    close();
    load();
  }

  /* -------------------------------- states ---------------------------------- */

  if (error && !data) {
    return (
      <div className="max-w-5xl" dir={isAr ? "rtl" : "ltr"}>
        <h1 className="text-2xl font-bold text-gray-900 mb-4">{p.title}</h1>
        <LoadError
          variant="empty"
          text={error.timedOut ? c.timedOut : c.loadError}
          retry={c.retry}
          onRetry={load}
          loading={loading}
        />
      </div>
    );
  }
  if (!data) return <div className="flex justify-center py-16"><Spinner text={c.loading} /></div>;
  const dataAge = data.meta?.dataAgeMs ?? 0;

  return (
    <div className="max-w-5xl" dir={isAr ? "rtl" : "ltr"}>
      <div className="mb-5 sm:mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-gray-900">{p.title}</h1>
          <button onClick={load} className={iconBtnCls} title={p.refresh} aria-label={p.refresh} disabled={loading}>
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
        <p className="text-sm text-gray-500 mt-1">{p.subtitle}</p>
        {error && (
          <LoadError
            className="mt-2"
            text={error.timedOut ? c.timedOut : c.loadError}
            retry={c.retry}
            onRetry={load}
            loading={loading}
          />
        )}
        {dataAge > STALE_AFTER_MS && (
          <p className="text-xs text-amber-700 mt-2">{fill(p.dataAge, { age: ageLabel(dataAge, isAr) })}</p>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-1">
        <StatTile
          label={p.tilePending} value={fmtNum(counts.pending, isAr)}
          tone={counts.pending ? "red" : undefined}
          active={tile === "pending"} onClick={() => setTile(tile === "pending" ? "" : "pending")}
        />
        <StatTile
          label={p.tileAccepted} value={fmtNum(counts.accepted, isAr)}
          active={tile === "accepted"} onClick={() => setTile(tile === "accepted" ? "" : "accepted")}
        />
        <StatTile
          label={p.tileRejected} value={fmtNum(counts.rejected, isAr)}
          active={tile === "rejected"} onClick={() => setTile(tile === "rejected" ? "" : "rejected")}
        />
        <StatTile
          label={p.tileCancelled} value={fmtNum(counts.cancelled, isAr)}
          active={tile === "cancelled"} onClick={() => setTile(tile === "cancelled" ? "" : "cancelled")}
        />
      </div>
      <p className="text-[11px] text-gray-400 mb-3">{p.tilesHint}</p>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <label className="relative flex-1 min-w-[14rem]">
          <Search size={15} className="absolute top-1/2 -translate-y-1/2 start-3 text-gray-400 pointer-events-none" />
          <input
            className="w-full border border-gray-300 rounded-lg ps-9 pe-9 py-2 min-h-11 sm:min-h-0 text-base sm:text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
            placeholder={p.search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={p.search}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute top-1/2 -translate-y-1/2 end-2 min-w-8 min-h-8 inline-flex items-center justify-center text-gray-400 hover:text-gray-700 rounded"
              aria-label={c.cancel}
            >
              <X size={14} />
            </button>
          )}
        </label>
        {filtered && (
          <button onClick={() => { setTile(""); setSearch(""); }} className={iconBtnCls}><X size={14} /> {p.all}</button>
        )}
      </div>

      {shown.length === 0 ? (
        <EmptyState text={filtered ? p.emptyFiltered : p.empty} />
      ) : (
        <div className="space-y-3">
          {shown.map((r) => (
            <RequestCard
              key={r.reqId || `${r.row}`}
              r={r} p={p} isAr={isAr}
              stateLabel={stateLabel}
              onOpen={() => openReview(r)}
            />
          ))}
        </div>
      )}

      <Modal
        open={!!openReq}
        title={fill(rejecting ? p.rejectTitle : p.preview.title, { ref: openReq?.reqId ?? "" })}
        onClose={close}
        isAr={isAr}
      >
        {openReq && (
          <>
            {/* What the customer asked for — never edited, only answered. */}
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 mb-4 space-y-1">
              <p className="text-sm font-semibold text-gray-900">{openReq.product || "—"}</p>
              <p className="text-xs text-gray-600">{p.client}: {openReq.client || "—"}</p>
              <p className="text-xs text-gray-600 tabular-nums">
                {p.asked}: {fmtNum(openReq.qtyAsked, isAr)} {openReq.unit}
                {openReq.unit === UNIT_PIECES && openReq.qtyKg > 0 && (
                  <span className="text-gray-400"> · {fill(p.approx, { kg: fmtNum(openReq.qtyKg, isAr, 1) })}</span>
                )}
              </p>
              {openReq.wantedDate && (
                <p className="text-xs text-gray-600">{p.wanted}: <bdi dir="ltr">{openReq.wantedDate}</bdi></p>
              )}
              {openReq.note && <p className="text-xs text-gray-600">{p.note}: {openReq.note}</p>}
            </div>

            {previewing && <div className="py-6 flex justify-center"><Spinner text={p.preview.loading} /></div>}

            {!previewing && !rejecting && duplicates.length > 1 && (
              <div className="mb-4">
                <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
                  {p.preview.duplicates}
                </p>
                <div className="space-y-2">
                  {duplicates.map((d) => (
                    <button
                      key={d.masterRow}
                      type="button"
                      onClick={() => openReview(openReq, d.masterRow)}
                      aria-pressed={pickedRow === d.masterRow}
                      className={`w-full text-start min-h-11 px-3 py-2 rounded-lg border text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
                        pickedRow === d.masterRow
                          ? "border-blue-400 ring-2 ring-blue-500/20 bg-blue-50/40"
                          : "border-gray-300 bg-white hover:bg-gray-50"
                      }`}
                    >
                      <span className="block font-medium text-gray-900">{d.client || "—"}</span>
                      <span className="block text-xs text-gray-500">
                        {fill(p.preview.duplicatesRow, { row: d.masterRow })}
                        {d.moldNumber ? ` · ${p.preview.moldNumber} ${d.moldNumber}` : ""}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!previewing && !rejecting && preview?.ok && (
              <>
                {preview.existingCode && (
                  <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
                    {fill(p.preview.alreadyCreated, { code: preview.existingCode })}
                  </p>
                )}
                <div className="grid grid-cols-2 gap-x-4 text-xs text-gray-600 mb-3">
                  <p>{p.preview.code}: <bdi dir="ltr">{preview.code || "—"}</bdi></p>
                  <p>{p.preview.status}: {p.preview.notStarted}</p>
                  <p>{p.preview.moldNumber}: <bdi dir="ltr">{preview.moldCode || "—"}</bdi></p>
                  <p>
                    {p.preview.machine}:{" "}
                    {preview.machine ? <bdi dir="ltr">{preview.machine}</bdi> : <span className="text-gray-400">{p.preview.machineNone}</span>}
                  </p>
                </div>
                {/* noValidate on the form: the browser's own bubbles are often
                    English, which is exactly what must not appear here. */}
                <form onSubmit={(e) => { e.preventDefault(); approve(); }} noValidate>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4">
                    <Field label={p.preview.qtyKg}>
                      <input
                        className={inputCls} type="number" inputMode="decimal" min="0" step="any"
                        value={form.qtyKg}
                        onChange={(e) => setForm((f) => ({ ...f, qtyKg: e.target.value }))}
                      />
                      <span className="block text-[11px] text-gray-500 mt-1">{p.preview.qtyKgHint}</span>
                    </Field>
                    <Field label={p.preview.startDate}>
                      <input
                        className={inputCls} type="date" value={form.startDate}
                        onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                      />
                    </Field>
                    <Field label={p.preview.dueDate}>
                      <input
                        className={inputCls} type="date" value={form.dueDate}
                        onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                      />
                      {preview.wantedDate && preview.wantedDate !== form.dueDate && (
                        <span className="block text-[11px] text-gray-500 mt-1">
                          {fill(p.preview.dueHint, { date: preview.wantedDate })}
                        </span>
                      )}
                    </Field>
                  </div>
                  {saveErr && <p className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mb-2">{saveErr}</p>}
                  <div className="flex flex-wrap items-center gap-3 mt-2">
                    <Btn type="submit" disabled={!canApprove} className="flex-1 sm:flex-none min-h-12 sm:min-h-10">
                      <Check size={16} /> {saving ? p.approving : p.approve}
                    </Btn>
                    <Btn type="button" variant="outline" onClick={() => { setRejecting(true); setSaveErr(""); }}>
                      {p.reject}
                    </Btn>
                  </div>
                </form>
              </>
            )}

            {!previewing && !rejecting && preview && !preview.ok && preview.reason !== "duplicate_product" && (
              <>
                <p className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mb-3">
                  {saveErr || p.preview.failed}
                </p>
                <Btn type="button" variant="outline" onClick={() => { setRejecting(true); setSaveErr(""); }}>
                  {p.reject}
                </Btn>
              </>
            )}

            {rejecting && (
              <form onSubmit={(e) => { e.preventDefault(); reject(); }} noValidate>
                <Field label={p.rejectReason}>
                  <textarea
                    className={`${inputCls} resize-none`} rows={3}
                    placeholder={p.rejectPlaceholder}
                    value={why}
                    onChange={(e) => setWhy(e.target.value)}
                  />
                </Field>
                {saveErr && <p className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mb-2">{saveErr}</p>}
                {!why.trim() && <p className="text-xs text-gray-500 mb-2">{p.needReason}</p>}
                <div className="flex flex-wrap items-center gap-3 mt-2">
                  <Btn type="submit" disabled={!why.trim() || saving} className="flex-1 sm:flex-none min-h-12 sm:min-h-10">
                    {saving ? p.rejecting : p.rejectGo}
                  </Btn>
                  <Btn type="button" variant="outline" onClick={() => { setRejecting(false); setSaveErr(""); }}>
                    {p.back}
                  </Btn>
                </div>
              </form>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}

/* --------------------------------- pieces --------------------------------- */

type P = (typeof cp)["en"]["staff"]["reqs"];

function RequestCard({ r, p, isAr, stateLabel, onOpen }: {
  r: ReqRow; p: P; isAr: boolean; stateLabel: (s: string) => string; onOpen: () => void;
}) {
  const pending = r.state === "pending";
  return (
    <div className={`bg-white border rounded-xl p-4 sm:p-5 ${pending ? "border-amber-200" : "border-gray-200"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold text-gray-900"><bdi dir="ltr">{r.reqId || "—"}</bdi></span>
            <Pill text={stateLabel(r.state)} tone={stateTone(r.state)} />
          </div>
          <p className="text-sm text-gray-700 mt-1.5">
            {[r.client, r.product].filter(Boolean).join(" · ") || "—"}
          </p>
          <p className="text-[11px] text-gray-500 mt-0.5 tabular-nums">
            {p.asked}: {fmtNum(r.qtyAsked, isAr)} {r.unit}
            {r.unit === UNIT_PIECES && r.qtyKg > 0 && (
              <span className="text-gray-400"> · {fill(p.approx, { kg: fmtNum(r.qtyKg, isAr, 1) })}</span>
            )}
          </p>
          {r.wantedDate && (
            <p className="text-xs text-gray-500 mt-0.5">{p.wanted}: <bdi dir="ltr">{r.wantedDate}</bdi></p>
          )}
          {r.submittedAt && (
            <p className="text-[11px] text-gray-400 mt-0.5">{p.submitted}: <bdi dir="ltr">{r.submittedAt}</bdi></p>
          )}
          {r.note && <p className="text-xs text-gray-600 mt-1">{p.note}: {r.note}</p>}
          {r.jobCode && (
            <p className="text-xs text-emerald-700 mt-1">{fill(p.order, { code: r.jobCode })}</p>
          )}
          {r.rejectReason && (
            <p className="text-xs text-red-700 mt-1">{fill(p.why, { reason: r.rejectReason })}</p>
          )}
          {r.decidedBy && (
            <p className="text-[11px] text-gray-400 mt-0.5">{fill(p.decidedBy, { who: r.decidedBy })}</p>
          )}
        </div>
        {pending && (
          <Btn onClick={onOpen} className="shrink-0 min-h-11">
            <Inbox size={15} /> {p.review}
          </Btn>
        )}
      </div>
    </div>
  );
}
