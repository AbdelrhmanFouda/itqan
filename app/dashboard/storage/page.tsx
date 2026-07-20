"use client";
/**
 * المخزن — Storage page.
 *
 * Reads balance + إيداع/سحب logs from the separate «مخزن اتقان» sheet through
 * /api/storage (its own Apps Script bridge). The storage role (+ owner/manager)
 * records, edits and deletes movements; production/quality see the stock levels
 * read-only. Saving reuses the sheet's own validation server-side, including
 * the insufficient-balance block on withdrawals.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "@/context/LangContext";
import { useAuth } from "@/context/AuthContext";
import { sd } from "@/lib/i18n.storage";
import { hasFullAccess } from "@/lib/roles";
import { Btn, EmptyState, Field, inputCls, Modal, Spinner, Stat } from "@/components/dashboard/ui";
import { Pencil, Plus, RefreshCw, Trash2, ExternalLink, ListRestart } from "lucide-react";
import type { StorageBalance, StorageData, StorageMovement } from "@/lib/storage";

const SHEET_URL = "https://docs.google.com/spreadsheets/d/1jmPjBFMCcoZmaVeLUD_wLCRtat3RCQ2c7c_UVtsW4gw/edit";

type Tab = "balance" | "in" | "out";

const num = (s: string | number | undefined): number => {
  const n = parseFloat(String(s ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const todayStr = () => new Date().toLocaleDateString("en-CA"); // yyyy-mm-dd, local tz

type FormState = {
  moveType: "إيداع" | "سحب";
  itemType: "منتج" | "خامة";
  item: string; client: string; loc: string; date: string;
  qtyCount: string; qtyKg: string; grams: string; loss: string; notes: string;
};
const blankForm = (): FormState => ({
  moveType: "إيداع", itemType: "منتج", item: "", client: "", loc: "",
  date: todayStr(), qtyCount: "", qtyKg: "", grams: "", loss: "", notes: "",
});

export default function StoragePage() {
  const { lang } = useLang();
  const isAr = lang === "ar";
  const s = sd[lang];
  const { user, profile } = useAuth();
  const role = profile?.role ?? null;
  const canWrite = role !== null && (role === "storage" || hasFullAccess(role));

  const [data, setData] = useState<StorageData | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [tab, setTab] = useState<Tab>("balance");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");

  // modal state
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<StorageMovement | null>(null); // null = add
  const [form, setForm] = useState<FormState>(blankForm());
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState("");
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/storage", { cache: "no-store" });
      const json = (await res.json()) as StorageData;
      // never blank a filled table on a transient empty fetch
      setData((prev) => (json.ok || !prev ? json : prev));
      setLoadErr(!json.ok && json.configured);
    } catch {
      setLoadErr(true);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  const flash = (msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 5000);
  };

  async function post(payload: Record<string, unknown>): Promise<{ ok: boolean; num?: string; error?: string }> {
    const token = user ? await user.getIdToken() : "";
    const res = await fetch("/api/storage", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    return (await res.json().catch(() => ({ ok: false, error: "bad_response" }))) as {
      ok: boolean; num?: string; error?: string;
    };
  }

  /* ------------------------------ derived ------------------------------ */

  const lists = data?.lists;
  const itemOptions = form.itemType === "خامة" ? lists?.materials ?? [] : lists?.products ?? [];

  const q = search.trim().toLowerCase();
  const match = (...vals: string[]) => !q || vals.some((v) => v.toLowerCase().includes(q));
  const balance = (data?.balance ?? []).filter((b) => match(b.item, b.client, b.loc, b.itemType));
  const movements = (tab === "in" ? data?.inLog : data?.outLog) ?? [];
  const shownMovements = movements.filter((m) => match(m.num, m.item, m.client, m.loc)).slice().reverse();

  const negatives = (data?.balance ?? []).filter((b) => num(b.avail) < 0).length;

  // live computed fields — mirrors the sheet form's C16/C17/C18 formulas
  const pieces = form.itemType === "منتج" && num(form.qtyKg) > 0 && num(form.grams) > 0
    ? Math.round((num(form.qtyKg) * 1000 / num(form.grams)) * 100) / 100 : 0;
  const net = form.itemType === "خامة"
    ? Math.round((num(form.qtyKg) - num(form.loss)) * 100) / 100
    : Math.round((num(form.qtyCount) + pieces - num(form.loss)) * 100) / 100;
  const unit = form.itemType === "خامة" ? s.units.kg : s.units.pcs;
  const avail = useMemo(() => {
    if (!form.item || !data) return null;
    const row = data.balance.find((b) =>
      b.itemType === form.itemType && b.item === form.item.trim() &&
      b.client === form.client.trim() && b.loc === form.loc.trim());
    return row ? row.avail : "0";
  }, [data, form.item, form.itemType, form.client, form.loc]);

  /* ------------------------------ actions ------------------------------ */

  function openAdd() {
    setEditing(null);
    setForm(blankForm());
    setFormErr("");
    setOpen(true);
  }

  function openEdit(m: StorageMovement) {
    setEditing(m);
    setForm({
      moveType: m.log,
      itemType: m.itemType === "خامة" ? "خامة" : "منتج",
      item: m.item, client: m.client, loc: m.loc,
      date: m.date || todayStr(),
      qtyCount: m.qtyCount ? String(num(m.qtyCount)) : "",
      qtyKg: m.qtyKg ? String(num(m.qtyKg)) : "",
      grams: m.grams ? String(num(m.grams)) : "",
      loss: m.loss ? String(num(m.loss)) : "",
      notes: m.notes,
    });
    setFormErr("");
    setOpen(true);
  }

  function pickItem(item: string) {
    setForm((f) => {
      const w = f.itemType === "منتج" ? lists?.weights?.[item] : undefined;
      return { ...f, item, grams: w ? String(w) : f.grams };
    });
  }

  async function handleSave() {
    if (!form.item) { setFormErr(s.form.needItem); return; }
    setSaving(true);
    setFormErr("");
    const payload = {
      ...form,
      action: editing ? "update" : "save",
      ...(editing ? { log: editing.log, num: editing.num } : {}),
    };
    const res = await post(payload);
    setSaving(false);
    if (!res.ok) { setFormErr(res.error || "error"); return; }
    setOpen(false);
    flash(`${s.form.saved} ${res.num ?? ""} ✓`);
    load();
  }

  async function handleDelete(m: StorageMovement) {
    const msg = s.form.deleteConfirm.replace("{num}", m.num).replace("{log}", m.log);
    if (!window.confirm(msg)) return;
    const res = await post({ action: "delete", log: m.log, num: m.num });
    if (res.ok) { flash("✓"); load(); }
    else flash(res.error || "error");
  }

  async function handleRefreshLists() {
    flash("…");
    const res = await post({ action: "refresh" });
    flash(res.ok ? "✓" : res.error || "error");
    load();
  }

  /* ------------------------------ render ------------------------------ */

  if (!data) {
    return <Spinner text={s.title} />;
  }
  if (!data.configured) {
    return (
      <div>
        <h1 className="text-xl font-bold text-gray-900 mb-1">{s.title}</h1>
        <p className="text-sm text-gray-500 mb-6">{s.subtitle}</p>
        <EmptyState text={s.notConnected} />
      </div>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "balance", label: s.tabs.balance },
    ...(canWrite ? ([{ key: "in", label: s.tabs.in }, { key: "out", label: s.tabs.out }] as { key: Tab; label: string }[]) : []),
  ];

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <h1 className="text-xl font-bold text-gray-900">{s.title}</h1>
        <div className="flex items-center gap-2">
          {canWrite && (
            <>
              <a
                href={SHEET_URL} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <ExternalLink size={14} /> {s.openSheet}
              </a>
              <Btn variant="outline" onClick={handleRefreshLists}>
                <ListRestart size={14} /> {s.refreshLists}
              </Btn>
              <Btn onClick={openAdd}><Plus size={15} /> {s.form.addBtn}</Btn>
            </>
          )}
          <Btn variant="ghost" onClick={load}><RefreshCw size={14} /> {s.refresh}</Btn>
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-4">{s.subtitle}</p>

      {notice && (
        <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-4 inline-block">
          {notice}
        </p>
      )}
      {loadErr && <p className="text-xs text-amber-600 mb-3">{s.loadError}</p>}
      {!canWrite && <p className="text-xs text-gray-400 mb-3">{s.readOnly}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-6">
        <Stat label={s.stats.items} value={data.balance.length} />
        <Stat label={s.stats.movements} value={data.inLog.length + data.outLog.length} />
        <Stat label={s.stats.negative} value={negatives} tone={negatives > 0 ? "red" : "green"} />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex rounded-lg border border-gray-200 bg-white p-0.5">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3.5 py-1.5 rounded-md text-sm transition-colors ${
                tab === t.key ? "bg-blue-600 text-white font-medium" : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={s.search}
          className={`${inputCls} sm:max-w-xs`}
        />
      </div>

      {tab === "balance" ? (
        <BalanceView rows={balance} s={s} />
      ) : (
        <MovementsView rows={shownMovements} s={s} canWrite={canWrite} onEdit={openEdit} onDelete={handleDelete} />
      )}

      <Modal open={open} title={editing ? `${s.form.editTitle} — ${editing.num}` : s.form.addTitle} onClose={() => setOpen(false)} isAr={isAr}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
          <Field label={s.form.moveType}>
            <select
              className={inputCls}
              value={form.moveType}
              disabled={!!editing}
              onChange={(e) => setForm((f) => ({ ...f, moveType: e.target.value as FormState["moveType"] }))}
            >
              <option value="إيداع">{s.moveTypes.in}</option>
              <option value="سحب">{s.moveTypes.out}</option>
            </select>
          </Field>
          <Field label={s.form.itemType}>
            <select
              className={inputCls}
              value={form.itemType}
              onChange={(e) =>
                setForm((f) => ({ ...f, itemType: e.target.value as FormState["itemType"], item: "", grams: "" }))
              }
            >
              <option value="منتج">{s.itemTypes.product}</option>
              <option value="خامة">{s.itemTypes.material}</option>
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label={s.form.item}>
              <select className={inputCls} value={form.item} onChange={(e) => pickItem(e.target.value)}>
                <option value="">{s.form.selectItem}</option>
                {itemOptions.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label={s.form.client}>
            <>
              <input
                list="storage-clients"
                className={inputCls}
                value={form.client}
                onChange={(e) => setForm((f) => ({ ...f, client: e.target.value }))}
                placeholder={s.form.anyClient}
              />
              <datalist id="storage-clients">
                {(lists?.clients ?? []).map((c) => <option key={c} value={c} />)}
              </datalist>
            </>
          </Field>
          <Field label={s.form.loc}>
            <input className={inputCls} value={form.loc} onChange={(e) => setForm((f) => ({ ...f, loc: e.target.value }))} />
          </Field>
          <Field label={s.form.date}>
            <input type="date" className={inputCls} value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
          </Field>
          {form.itemType === "منتج" && (
            <Field label={s.form.qtyCount}>
              <input type="number" min={0} className={inputCls} value={form.qtyCount} onChange={(e) => setForm((f) => ({ ...f, qtyCount: e.target.value }))} />
            </Field>
          )}
          <Field label={s.form.qtyKg}>
            <input type="number" min={0} className={inputCls} value={form.qtyKg} onChange={(e) => setForm((f) => ({ ...f, qtyKg: e.target.value }))} />
          </Field>
          {form.itemType === "منتج" && (
            <Field label={`${s.form.grams} (${s.form.gramsAuto})`}>
              <input type="number" min={0} className={inputCls} value={form.grams} onChange={(e) => setForm((f) => ({ ...f, grams: e.target.value }))} />
            </Field>
          )}
          <Field label={s.form.loss}>
            <input type="number" min={0} className={inputCls} value={form.loss} onChange={(e) => setForm((f) => ({ ...f, loss: e.target.value }))} />
          </Field>
          <div className="sm:col-span-2">
            <Field label={s.form.notes}>
              <input className={inputCls} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </Field>
          </div>
        </div>

        <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 mb-4 grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
          {form.itemType === "منتج" && (
            <div><span className="text-gray-500">{s.form.calcPieces}:</span> <b>{pieces || 0}</b></div>
          )}
          <div>
            <span className="text-gray-500">{s.form.calcNet}:</span>{" "}
            <b className={net <= 0 ? "text-red-600" : "text-gray-900"}>{Number.isFinite(net) ? net : 0} {unit}</b>
          </div>
          {avail !== null && (
            <div><span className="text-gray-500">{s.form.avail}:</span> <b>{avail || "0"} {unit}</b></div>
          )}
        </div>

        {formErr && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{formErr}</p>}

        <div className="flex justify-end gap-2">
          <Btn variant="outline" onClick={() => setOpen(false)}>{s.form.cancel}</Btn>
          <Btn onClick={handleSave} disabled={saving}>{saving ? s.form.saving : s.form.save}</Btn>
        </div>
      </Modal>
    </div>
  );
}

/* ------------------------------ balance view ------------------------------ */

function BalanceView({ rows, s }: { rows: StorageBalance[]; s: (typeof sd)["en"] | (typeof sd)["ar"] }) {
  if (rows.length === 0) return <EmptyState text={s.empty} />;
  const availCls = (v: string) =>
    num(v) < 0 ? "text-red-600" : num(v) === 0 ? "text-gray-400" : "text-emerald-700";
  return (
    <>
      {/* phones: cards */}
      <div className="sm:hidden space-y-2">
        {rows.map((b, i) => (
          <div key={i} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center justify-between gap-2 mb-1">
              <p className="font-medium text-gray-900">{b.item}</p>
              <span className="text-xs text-gray-400 whitespace-nowrap">{b.itemType}</span>
            </div>
            <p className={`text-lg font-bold ${availCls(b.avail)}`}>{b.avail || "0"} {b.unit}</p>
            {(b.client || b.loc) && (
              <p className="text-xs text-gray-500 mt-1">{[b.client, b.loc].filter(Boolean).join(" · ")}</p>
            )}
            <p className="text-xs text-gray-400 mt-1">
              {s.cols.inQty}: {b.inQty || "0"} — {s.cols.outQty}: {b.outQty || "0"} — {s.cols.loss}: {b.loss || "0"}
            </p>
          </div>
        ))}
      </div>
      {/* sm+: table */}
      <div className="hidden sm:block bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-start text-xs text-gray-500 border-b border-gray-100">
              {[s.cols.itemType, s.cols.item, s.cols.client, s.cols.loc, s.cols.avail, s.cols.inQty, s.cols.inLast, s.cols.outQty, s.cols.outLast, s.cols.loss].map((h) => (
                <th key={h} className="text-start font-medium px-4 py-3 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((b, i) => (
              <tr key={i} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{b.itemType}</td>
                <td className="px-4 py-2.5 font-medium text-gray-900">{b.item}</td>
                <td className="px-4 py-2.5 text-gray-600">{b.client || "—"}</td>
                <td className="px-4 py-2.5 text-gray-600">{b.loc || "—"}</td>
                <td className={`px-4 py-2.5 font-bold whitespace-nowrap ${availCls(b.avail)}`}>{b.avail || "0"} {b.unit}</td>
                <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{b.inQty || "0"}</td>
                <td className="px-4 py-2.5 text-gray-400 whitespace-nowrap">{b.inLast || "—"}</td>
                <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{b.outQty || "0"}</td>
                <td className="px-4 py-2.5 text-gray-400 whitespace-nowrap">{b.outLast || "—"}</td>
                <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{b.loss || "0"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ----------------------------- movements view ----------------------------- */

function MovementsView({
  rows, s, canWrite, onEdit, onDelete,
}: {
  rows: StorageMovement[];
  s: (typeof sd)["en"] | (typeof sd)["ar"];
  canWrite: boolean;
  onEdit: (m: StorageMovement) => void;
  onDelete: (m: StorageMovement) => void;
}) {
  if (rows.length === 0) return <EmptyState text={s.empty} />;
  return (
    <>
      {/* phones: cards */}
      <div className="sm:hidden space-y-2">
        {rows.map((m) => (
          <div key={`${m.log}-${m.num}`} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center justify-between gap-2 mb-1">
              <p className="font-mono text-xs text-gray-500">{m.num}</p>
              <span className="text-xs text-gray-400">{m.date}</span>
            </div>
            <p className="font-medium text-gray-900">{m.item}</p>
            <p className="text-sm text-gray-700 mt-0.5">{s.cols.net}: <b>{m.net || "0"} {m.unit}</b></p>
            {(m.client || m.loc) && (
              <p className="text-xs text-gray-500 mt-1">{[m.client, m.loc].filter(Boolean).join(" · ")}</p>
            )}
            {m.notes && <p className="text-xs text-gray-400 mt-1">{m.notes}</p>}
            {canWrite && (
              <div className="flex gap-2 mt-2">
                <Btn variant="ghost" onClick={() => onEdit(m)}><Pencil size={13} /></Btn>
                <Btn variant="danger" onClick={() => onDelete(m)}><Trash2 size={13} /></Btn>
              </div>
            )}
          </div>
        ))}
      </div>
      {/* sm+: table */}
      <div className="hidden sm:block bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 border-b border-gray-100">
              {[s.cols.num, s.cols.itemType, s.cols.item, s.cols.client, s.cols.loc, s.cols.date, s.cols.qtyCount, s.cols.qtyKg, s.cols.loss, s.cols.net, s.cols.notes].map((h) => (
                <th key={h} className="text-start font-medium px-4 py-3 whitespace-nowrap">{h}</th>
              ))}
              {canWrite && <th className="px-2 py-3" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={`${m.log}-${m.num}`} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                <td className="px-4 py-2.5 font-mono text-xs text-gray-500 whitespace-nowrap">{m.num}</td>
                <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{m.itemType}</td>
                <td className="px-4 py-2.5 font-medium text-gray-900">{m.item}</td>
                <td className="px-4 py-2.5 text-gray-600">{m.client || "—"}</td>
                <td className="px-4 py-2.5 text-gray-600">{m.loc || "—"}</td>
                <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{m.date}</td>
                <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{m.qtyCount || "—"}</td>
                <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{m.qtyKg || "—"}</td>
                <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{m.loss || "0"}</td>
                <td className="px-4 py-2.5 font-semibold text-gray-900 whitespace-nowrap">{m.net || "0"} {m.unit}</td>
                <td className="px-4 py-2.5 text-gray-400 max-w-[16rem] truncate">{m.notes}</td>
                {canWrite && (
                  <td className="px-2 py-2.5 whitespace-nowrap">
                    <button onClick={() => onEdit(m)} className="text-gray-400 hover:text-blue-600 p-1.5" aria-label="edit">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => onDelete(m)} className="text-gray-400 hover:text-red-600 p-1.5" aria-label="delete">
                      <Trash2 size={14} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
