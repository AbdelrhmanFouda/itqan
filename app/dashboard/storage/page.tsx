"use client";
import { usePageTitle } from "@/components/dashboard/use-page-title";
/**
 * المخزن — Storage page.
 *
 * Reads balance + إيداع/سحب logs from the separate «مخزن اتقان» sheet through
 * /api/storage (its own Apps Script bridge). The storage role (+ owner/manager)
 * records, edits and deletes movements; production/quality see the stock levels
 * read-only. Saving reuses the sheet's own validation server-side, including
 * the insufficient-balance block on withdrawals.
 *
 * FINDING THINGS (2026-08-30). The page used to offer one text box matching four
 * fields, which is not enough once the room is 55 slots deep: the question a
 * storekeeper actually asks is «what is standing in A12» and «where is this
 * item», and neither was answerable here. So:
 *   - search is Arabic-folded and multi-term (lib/storage-filter.ts),
 *   - location / item-type / stock-level filters and a sort apply to all tabs,
 *   - a tappable map of the room (grouped by line, counts per slot) filters by
 *     one tap,
 *   - the movement form picks the location from «أماكن التخزين» instead of
 *     free text, and shows where the chosen item is standing right now.
 * The location filter folds case on purpose — see the note in storage-filter.ts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "@/context/LangContext";
import { useAuth } from "@/context/AuthContext";
import { authedFetch } from "@/lib/authed-fetch";
import { sd } from "@/lib/i18n.storage";
import { hasFullAccess } from "@/lib/roles";
import {
  NO_LOCATION, buildFloorPlan, collectLocations, compareLocKey, locKey, matchesTerms,
  sameLocation, searchTerms, toNumber as num, whereIs,
  type FloorPlan, type LocationStat, type PlanSlot,
} from "@/lib/storage-filter";
import { Btn, EmptyState, Field, inputCls, Modal, Spinner, Stat } from "@/components/dashboard/ui";
import { FilteredEmpty, RoomPlan } from "@/components/dashboard/room-plan";
import {
  Pencil, Plus, RefreshCw, Trash2, ExternalLink, ListRestart, Search, X, MapPin,
  ChevronDown, ChevronUp,
} from "lucide-react";
import type { StorageBalance, StorageData, StorageMovement } from "@/lib/storage";

const SHEET_URL = "https://docs.google.com/spreadsheets/d/1jmPjBFMCcoZmaVeLUD_wLCRtat3RCQ2c7c_UVtsW4gw/edit";

type Tab = "balance" | "in" | "out";
type Sort = "sheet" | "item" | "loc" | "avail";
type Status = "" | "in" | "zero" | "neg";
type ItemType = "" | "منتج" | "خامة";

const todayStr = () => new Date().toLocaleDateString("en-CA"); // yyyy-mm-dd, local tz
/** The sheet writes «خامة»/«منتج»; be tolerant of a stray «خامات» or a space. */
const isMaterial = (t: string | undefined) => String(t ?? "").trim().startsWith("خام");
const r2 = (n: number) => Math.round(n * 100) / 100;

type FormState = {
  moveType: "إيداع" | "سحب";
  itemType: "منتج" | "خامة";
  item: string; client: string; forClient: string; loc: string; date: string;
  qtyCount: string; qtyKg: string; grams: string; loss: string; notes: string;
};
const blankForm = (): FormState => ({
  moveType: "إيداع", itemType: "منتج", item: "", client: "", forClient: "", loc: "",
  date: todayStr(), qtyCount: "", qtyKg: "", grams: "", loss: "", notes: "",
});

export default function StoragePage() {
  const { lang } = useLang();
  const isAr = lang === "ar";
  const s = sd[lang];
  usePageTitle(s.title);
  const { user, profile } = useAuth();
  const role = profile?.role ?? null;
  const canWrite = role !== null && (role === "storage" || hasFullAccess(role));

  const [data, setData] = useState<StorageData | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [tab, setTab] = useState<Tab>("balance");
  const [notice, setNotice] = useState("");

  // filters
  const [search, setSearch] = useState("");
  const [locFilter, setLocFilter] = useState("");      // "" = all, NO_LOCATION = unfiled
  const [typeFilter, setTypeFilter] = useState<ItemType>("");
  const [statusFilter, setStatusFilter] = useState<Status>("");
  const [sortBy, setSortBy] = useState<Sort>("sheet");
  const [mapOpen, setMapOpen] = useState(true);

  // modal state
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<StorageMovement | null>(null); // null = add
  const [form, setForm] = useState<FormState>(blankForm());
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState("");
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await authedFetch("/api/storage", { cache: "no-store" });
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

  async function post(payload: Record<string, unknown>): Promise<{
    ok: boolean; num?: string; nums?: string[]; split?: boolean; message?: string; error?: string;
  }> {
    const token = user ? await user.getIdToken() : "";
    const res = await fetch("/api/storage", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    return (await res.json().catch(() => ({ ok: false, error: "bad_response" }))) as {
      ok: boolean; num?: string; nums?: string[]; split?: boolean; message?: string; error?: string;
    };
  }

  /* ------------------------------ derived ------------------------------ */

  const lists = data?.lists;
  const itemOptions = form.itemType === "خامة" ? lists?.materials ?? [] : lists?.products ?? [];
  // What the DEPLOYED bridge can actually do — measured, not assumed. The live
  // deployment was still v3 on 2026-08-30, so both of these are false there and
  // the page must not offer what the sheet would drop on the floor.
  const hasForClient = data?.supportsForClient ?? false;
  // «أماكن التخزين» exists → the sheet publishes the FULL list of slots, empty
  // ones included, and the site can be as strict as the sheet's own dropdown.
  // Without it we only know the slots already in use, and a strict select would
  // make it impossible to deposit into the 34 slots nobody has filled yet.
  const strictLocations = (lists?.locations?.length ?? 0) > 0;
  const allBalance = useMemo(() => data?.balance ?? [], [data]);
  const allMovements = useMemo(
    () => [...(data?.inLog ?? []), ...(data?.outLog ?? [])],
    [data],
  );

  // Every place the room knows about: «أماكن التخزين» through the bridge, plus
  // anything only the data mentions (an older bridge sends no list at all).
  const locStats = useMemo(
    () => collectLocations(allBalance, allMovements, lists?.locations ?? []),
    [allBalance, allMovements, lists?.locations],
  );
  const locCount = useCallback(
    (l: LocationStat) => (tab === "balance" ? l.lines : l.moves),
    [tab],
  );
  const locLabel = useCallback(
    (l: LocationStat) => (l.key === NO_LOCATION ? s.filters.noLocation : l.label),
    [s.filters.noLocation],
  );
  // The room as the owner drew it: one box per physical column, its four places
  // written around it. buildFloorPlan() explains why the grouping is what it is.
  const plan = useMemo(() => buildFloorPlan(locStats), [locStats]);
  // the dropdown keeps the flat grouping — a list is the right shape there
  const locGroups = useMemo(() => {
    const map = new Map<string, LocationStat[]>();
    locStats.forEach((l) => {
      const g = l.key === NO_LOCATION ? "" : l.group;
      const arr = map.get(g);
      if (arr) arr.push(l);
      else map.set(g, [l]);
    });
    return [...map.entries()].sort((a, b) => (a[0] ? (b[0] ? a[0].localeCompare(b[0]) : -1) : 1));
  }, [locStats]);
  const groupLabel = (g: string) => (g ? s.filters.shelfLine.replace("{g}", g) : s.filters.otherZones);

  const terms = useMemo(() => searchTerms(search), [search]);
  const typeOk = useCallback(
    (t: string) => !typeFilter || isMaterial(t) === (typeFilter === "خامة"),
    [typeFilter],
  );

  const balance = useMemo(() => {
    const rows = allBalance.filter((b) =>
      sameLocation(b.loc, locFilter) &&
      typeOk(b.itemType) &&
      (!statusFilter ||
        (statusFilter === "neg" ? num(b.avail) < 0
          : statusFilter === "zero" ? num(b.avail) === 0
          : num(b.avail) > 0)) &&
      matchesTerms([b.item, b.client, b.loc, b.itemType, b.unit], terms));
    if (sortBy === "sheet") return rows;
    const sorted = [...rows];
    if (sortBy === "item") sorted.sort((a, b) => a.item.localeCompare(b.item, "ar"));
    else if (sortBy === "loc") sorted.sort((a, b) => compareLocKey(locKey(a.loc), locKey(b.loc)));
    else sorted.sort((a, b) => num(b.avail) - num(a.avail));
    return sorted;
  }, [allBalance, locFilter, typeOk, statusFilter, terms, sortBy]);

  const movements = useMemo(() => (tab === "in" ? data?.inLog : data?.outLog) ?? [], [tab, data]);
  const shownMovements = useMemo(
    () => movements
      .filter((m) =>
        sameLocation(m.loc, locFilter) &&
        typeOk(m.itemType) &&
        matchesTerms([m.num, m.item, m.client, m.forClient, m.loc, m.date, m.notes], terms))
      .slice()
      .reverse(),
    [movements, locFilter, typeOk, terms],
  );

  const shownCount = tab === "balance" ? balance.length : shownMovements.length;
  const totalCount = tab === "balance" ? allBalance.length : movements.length;
  const filtered = Boolean(search || locFilter || typeFilter || statusFilter);
  const negatives = allBalance.filter((b) => num(b.avail) < 0).length;

  function clearFilters() {
    setSearch("");
    setLocFilter("");
    setTypeFilter("");
    setStatusFilter("");
  }

  /* --------------------------- form-side derived --------------------------- */

  // live computed fields — mirrors the sheet form's C17/C18/C19 formulas
  const pieces = form.itemType === "منتج" && num(form.qtyKg) > 0 && num(form.grams) > 0
    ? r2(num(form.qtyKg) * 1000 / num(form.grams)) : 0;
  const net = form.itemType === "خامة"
    ? r2(num(form.qtyKg) - num(form.loss))
    : r2(num(form.qtyCount) + pieces - num(form.loss));
  const unit = form.itemType === "خامة" ? s.units.kg : s.units.pcs;

  // Where the chosen item is standing right now — the thing you need before a
  // withdrawal, and the reason the location field can stay a pick rather than
  // a guess. Owner-blind on purpose: it answers "where", not "whose".
  const standingAt = useMemo(
    () => (form.item ? whereIs(allBalance, form.item, form.itemType) : []),
    [allBalance, form.item, form.itemType],
  );

  // v4: a blank location on a سحب means "all locations" — the sheet's own C19
  // says «… — كل الأماكن» in that case, so this must agree or the two forms
  // disagree about the same withdrawal.
  const avail = useMemo(() => {
    if (!form.item || !data) return null;
    const rows = data.balance.filter((b) =>
      isMaterial(b.itemType) === isMaterial(form.itemType) &&
      b.item.trim() === form.item.trim() &&
      b.client.trim() === form.client.trim());
    if (!form.loc.trim()) {
      return { qty: r2(rows.reduce((t, b) => t + num(b.avail), 0)), all: true };
    }
    const key = locKey(form.loc);
    return { qty: r2(rows.filter((b) => locKey(b.loc) === key).reduce((t, b) => t + num(b.avail), 0)), all: false };
  }, [data, form.item, form.itemType, form.client, form.loc]);

  // The form offers every place «أماكن التخزين» defines — including the empty
  // slots, which are exactly the ones a deposit goes into — plus the value the
  // row being edited already carries, so editing can never silently move stock.
  const formLocations = useMemo(() => {
    const opts = locStats.filter((l) => l.key !== NO_LOCATION).map((l) => l.label);
    // EXACT match, not locKey(): the sheet keys stock on the string as typed, so
    // a row standing at the stale lowercase `a12` must stay selectable as `a12`.
    // Folding here would leave the select showing a blank while the form still
    // held a value — and withdrawing from `A12` would be refused for no balance.
    const cur = form.loc.trim();
    if (cur && !opts.includes(cur)) opts.push(cur);
    return opts;
  }, [locStats, form.loc]);
  const locIsUnknown = Boolean(
    form.loc.trim() && !locStats.some((l) => l.key === locKey(form.loc)),
  );

  /* ------------------------------ actions ------------------------------ */

  function openAdd() {
    setEditing(null);
    // a location already being filtered on is almost certainly the one being
    // filled — carry it into the form rather than making it be picked twice
    const pre = locStats.find((l) => l.key === locFilter && l.key !== NO_LOCATION);
    setForm({ ...blankForm(), loc: pre ? pre.label : "" });
    setFormErr("");
    setOpen(true);
  }

  function openEdit(m: StorageMovement) {
    setEditing(m);
    setForm({
      moveType: m.log,
      itemType: isMaterial(m.itemType) ? "خامة" : "منتج",
      item: m.item, client: m.client, forClient: m.forClient, loc: m.loc,
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
    // a withdrawal with no location can become several rows (v4 spreads it over
    // the places holding the item) — say so instead of naming one number
    flash(res.split && res.message ? res.message : `${s.form.saved} ${res.num ?? ""} ✓`);
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
    return (
      <div className="flex justify-center py-16">
        <Spinner text={isAr ? "جارٍ التحميل…" : "Loading…"} />
      </div>
    );
  }
  if (!data.configured) {
    return (
      <div dir={isAr ? "rtl" : "ltr"}>
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">{s.title}</h1>
          <p className="text-sm text-gray-500">{s.subtitle}</p>
        </div>
        <EmptyState text={s.notConnected} />
      </div>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "balance", label: s.tabs.balance },
    ...(canWrite ? ([{ key: "in", label: s.tabs.in }, { key: "out", label: s.tabs.out }] as { key: Tab; label: string }[]) : []),
  ];
  // NOT `inputCls`: that starts with w-full, and a select stretched to the full
  // width puts each filter on its own row of a phone. `w-auto` cannot fix it —
  // Tailwind resolves the two by stylesheet order, and w-full wins. Grow to
  // share a row instead, two per line at 375px.
  const selCls =
    "border border-gray-300 rounded-lg px-3 py-2 min-h-11 sm:min-h-0 text-base sm:text-sm " +
    "text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 " +
    "focus:border-blue-400 flex-1 min-w-[8.5rem] sm:flex-none sm:w-auto sm:max-w-[12rem]";
  const activeLoc = locStats.find((l) => l.key === locFilter);

  return (
    <div dir={isAr ? "rtl" : "ltr"}>
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">{s.title}</h1>
        <p className="text-sm text-gray-500">{s.subtitle}</p>
        {/* Actions row — always flex-wrap: this row once held four controls
            (~460px) in a single unbreakable line on a 375px screen. */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {canWrite && (
            <>
              <a
                href={SHEET_URL} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 min-h-11 sm:min-h-0 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1"
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

      {notice && (
        <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-4 inline-block">
          {notice}
        </p>
      )}
      {loadErr && <p className="text-xs text-amber-600 mb-3">{s.loadError}</p>}
      {!canWrite && <p className="text-xs text-gray-400 mb-3">{s.readOnly}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-6">
        <Stat label={s.stats.items} value={data.balance.length.toLocaleString(isAr ? "ar-EG" : "en-US")} />
        <Stat label={s.stats.movements} value={(data.inLog.length + data.outLog.length).toLocaleString(isAr ? "ar-EG" : "en-US")} />
        <Stat label={s.stats.negative} value={negatives.toLocaleString(isAr ? "ar-EG" : "en-US")} tone={negatives > 0 ? "red" : "green"} />
      </div>

      {/* ----------------------------- controls ----------------------------- */}
      <div className="space-y-3 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-3 py-1.5 min-h-11 sm:min-h-0 inline-flex items-center rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
                  tab === t.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-[13rem] sm:max-w-sm">
            <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={s.search}
              aria-label={s.search}
              className={`${inputCls} ps-9 pe-10`}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                aria-label={s.clearSearch}
                className="absolute end-1 top-1/2 -translate-y-1/2 min-w-9 min-h-9 inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
              >
                <X size={15} />
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={locFilter}
            onChange={(e) => setLocFilter(e.target.value)}
            aria-label={s.filters.location}
            className={`${selCls} ${locFilter ? "border-blue-400 text-blue-700" : ""}`}
          >
            <option value="">{s.filters.allLocations}</option>
            {locGroups.map(([g, items]) => (
              <optgroup key={g || "zones"} label={groupLabel(g)}>
                {items.map((l) => (
                  <option key={l.key} value={l.key}>
                    {locLabel(l)}{locCount(l) ? ` (${locCount(l)})` : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as ItemType)}
            aria-label={s.filters.itemType}
            className={`${selCls} ${typeFilter ? "border-blue-400 text-blue-700" : ""}`}
          >
            <option value="">{s.filters.allTypes}</option>
            <option value="منتج">{s.itemTypes.product}</option>
            <option value="خامة">{s.itemTypes.material}</option>
          </select>

          {tab === "balance" && (
            <>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as Status)}
                aria-label={s.filters.status}
                className={`${selCls} ${statusFilter ? "border-blue-400 text-blue-700" : ""}`}
              >
                <option value="">{s.filters.allStatus}</option>
                <option value="in">{s.filters.inStock}</option>
                <option value="zero">{s.filters.zero}</option>
                <option value="neg">{s.filters.negative}</option>
              </select>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as Sort)}
                aria-label={s.filters.sort}
                className={selCls}
              >
                <option value="sheet">{s.filters.sortSheet}</option>
                <option value="item">{s.filters.sortItem}</option>
                <option value="loc">{s.filters.sortLoc}</option>
                <option value="avail">{s.filters.sortAvail}</option>
              </select>
            </>
          )}

          {filtered && (
            <Btn variant="ghost" onClick={clearFilters}><X size={14} /> {s.filters.clear}</Btn>
          )}
          <span className="ms-auto text-xs text-gray-400 tabular-nums whitespace-nowrap">
            {s.filters.showing
              .replace("{n}", shownCount.toLocaleString(isAr ? "ar-EG" : "en-US"))
              .replace("{total}", totalCount.toLocaleString(isAr ? "ar-EG" : "en-US"))}
          </span>
        </div>

        {/* ------------------------- the room, tappable ------------------------- */}
        {locStats.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl">
            <button
              onClick={() => setMapOpen((v) => !v)}
              aria-expanded={mapOpen}
              className="w-full flex items-center gap-2 px-4 py-3 min-h-11 text-sm font-medium text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 rounded-xl"
            >
              <MapPin size={15} className="text-gray-400" />
              {s.filters.map}
              <span className="text-xs text-gray-400 tabular-nums">
                {locStats.filter((l) => l.key !== NO_LOCATION).length}
              </span>
              {activeLoc && (
                <span className="text-xs font-normal text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">
                  {s.filters.atLocation.replace("{loc}", locLabel(activeLoc))}
                </span>
              )}
              <span className="ms-auto text-gray-400">
                {mapOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </span>
            </button>
            {mapOpen && (
              <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
                <p className="text-xs text-gray-400">{s.filters.mapHint}</p>
                <RoomPlan
                  plan={plan}
                  active={locFilter}
                  count={locCount}
                  lineLabel={(l) => s.filters.shelfLine.replace("{g}", l)}
                  zonesLabel={s.filters.otherZones}
                  noLocLabel={s.filters.noLocation}
                  onPick={(k) => setLocFilter(locFilter === k ? "" : k)}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {tab === "balance" ? (
        balance.length === 0 && filtered
          ? <FilteredEmpty text={s.noMatch} label={s.filters.clear} onClear={clearFilters} />
          : <BalanceView rows={balance} s={s} />
      ) : (
        shownMovements.length === 0 && filtered
          ? <FilteredEmpty text={s.noMatch} label={s.filters.clear} onClear={clearFilters} />
          : <MovementsView rows={shownMovements} s={s} isAr={isAr} canWrite={canWrite} hasForClient={hasForClient} onEdit={openEdit} onDelete={handleDelete} />
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
            {form.item && (
              <div className="-mt-2 mb-3 text-xs">
                {standingAt.length === 0 ? (
                  <span className="text-gray-400">{s.form.foundNowhere}</span>
                ) : (
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="text-gray-500">{s.form.foundAt}:</span>
                    {standingAt.map((w, i) => (
                      <button
                        key={`${w.loc}-${i}`}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, loc: w.loc }))}
                        className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 min-h-9 tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
                          locKey(w.loc) === locKey(form.loc)
                            ? "border-blue-600 bg-blue-600 text-white"
                            : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        {w.loc} <b>{w.qty}</b> <span className="opacity-70">{w.unit}</span>
                      </button>
                    ))}
                  </span>
                )}
              </div>
            )}
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
          {hasForClient && (
            <Field label={s.form.forClient}>
              <input
                list="storage-clients"
                className={inputCls}
                value={form.forClient}
                onChange={(e) => setForm((f) => ({ ...f, forClient: e.target.value }))}
                placeholder={s.form.anyClient}
              />
            </Field>
          )}
          <div className="sm:col-span-2">
            <Field label={s.form.loc}>
              {strictLocations ? (
                <select
                  className={inputCls}
                  value={form.loc}
                  onChange={(e) => setForm((f) => ({ ...f, loc: e.target.value }))}
                >
                  <option value="">{s.form.anyLoc}</option>
                  {formLocations.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <>
                  <input
                    list="storage-locations"
                    className={inputCls}
                    value={form.loc}
                    onChange={(e) => setForm((f) => ({ ...f, loc: e.target.value }))}
                    placeholder={s.form.anyLoc}
                  />
                  <datalist id="storage-locations">
                    {formLocations.map((o) => <option key={o} value={o} />)}
                  </datalist>
                </>
              )}
            </Field>
            {locIsUnknown && <p className="-mt-2 mb-3 text-xs text-amber-600">{s.form.locUnknown}</p>}
            {form.moveType === "سحب" && !form.loc.trim() && (
              <p className="-mt-2 mb-3 text-xs text-gray-400">{s.form.locOutHint}</p>
            )}
          </div>
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
            <div>
              <span className="text-gray-500">{s.form.avail}:</span>{" "}
              <b>{avail.qty} {unit}</b>
              {avail.all && <span className="text-gray-400"> — {s.form.availAll}</span>}
            </div>
          )}
        </div>

        {formErr && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{formErr}</p>}

        <div className="flex flex-wrap items-center justify-end gap-3">
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
  const heads: { h: string; end?: boolean }[] = [
    { h: s.cols.itemType }, { h: s.cols.item }, { h: s.cols.client }, { h: s.cols.loc },
    { h: s.cols.avail, end: true }, { h: s.cols.inQty, end: true }, { h: s.cols.inLast },
    { h: s.cols.outQty, end: true }, { h: s.cols.outLast }, { h: s.cols.loss, end: true },
  ];
  return (
    <>
      {/* phones: cards */}
      <div className="sm:hidden space-y-3">
        {rows.map((b, i) => (
          <div key={i} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center justify-between gap-3 min-w-0 mb-1">
              <p className="font-medium text-gray-900 min-w-0 truncate">{b.item}</p>
              <span className="shrink-0 text-xs text-gray-400 whitespace-nowrap">{b.itemType}</span>
            </div>
            <p className={`text-lg font-bold tabular-nums ${availCls(b.avail)}`}>{b.avail || "0"} {b.unit}</p>
            <p className="text-xs text-gray-500 mt-1 flex flex-wrap items-center gap-1.5">
              {b.loc && (
                <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-1.5 py-0.5 text-gray-700" dir="ltr">
                  <MapPin size={11} />{b.loc}
                </span>
              )}
              {b.client && <span>{b.client}</span>}
            </p>
            <p className="text-xs text-gray-400 mt-1 tabular-nums">
              {s.cols.inQty}: {b.inQty || "0"} — {s.cols.outQty}: {b.outQty || "0"} — {s.cols.loss}: {b.loss || "0"}
            </p>
          </div>
        ))}
      </div>
      {/* sm+: table */}
      <div className="hidden sm:block bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/50">
                {heads.map((c) => (
                  <th key={c.h} className={`${c.end ? "text-end" : "text-start"} px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap`}>{c.h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((b, i) => (
                <tr key={i} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{b.itemType}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{b.item}</td>
                  <td className="px-4 py-3 text-gray-600">{b.client || "—"}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                    {b.loc
                      ? <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-1.5 py-0.5 text-gray-700 text-xs" dir="ltr"><MapPin size={11} />{b.loc}</span>
                      : "—"}
                  </td>
                  <td className={`px-4 py-3 text-end tabular-nums font-bold whitespace-nowrap ${availCls(b.avail)}`}>{b.avail || "0"} {b.unit}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-gray-600 whitespace-nowrap">{b.inQty || "0"}</td>
                  <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{b.inLast || "—"}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-gray-600 whitespace-nowrap">{b.outQty || "0"}</td>
                  <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{b.outLast || "—"}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-gray-600 whitespace-nowrap">{b.loss || "0"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ----------------------------- movements view ----------------------------- */

function MovementsView({
  rows, s, isAr, canWrite, hasForClient, onEdit, onDelete,
}: {
  rows: StorageMovement[];
  s: (typeof sd)["en"] | (typeof sd)["ar"];
  isAr: boolean;
  canWrite: boolean;
  hasForClient: boolean;
  onEdit: (m: StorageMovement) => void;
  onDelete: (m: StorageMovement) => void;
}) {
  if (rows.length === 0) return <EmptyState text={s.empty} />;
  const editLabel = isAr ? "تعديل" : "Edit";
  const deleteLabel = isAr ? "حذف" : "Delete";
  const heads: { h: string; end?: boolean }[] = [
    { h: s.cols.num }, { h: s.cols.itemType }, { h: s.cols.item }, { h: s.cols.client },
    ...(hasForClient ? [{ h: s.cols.forClient }] : []),
    { h: s.cols.loc }, { h: s.cols.date }, { h: s.cols.qtyCount, end: true },
    { h: s.cols.qtyKg, end: true }, { h: s.cols.loss, end: true }, { h: s.cols.net, end: true },
    { h: s.cols.notes },
  ];
  return (
    <>
      {/* phones: cards */}
      <div className="sm:hidden space-y-3">
        {rows.map((m) => (
          <div key={`${m.log}-${m.num}`} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center justify-between gap-3 min-w-0 mb-1">
              <p className="font-mono text-xs text-gray-500 min-w-0 truncate" dir="ltr">{m.num}</p>
              <span className="shrink-0 text-xs text-gray-400">{m.date}</span>
            </div>
            <p className="font-medium text-gray-900">{m.item}</p>
            <p className="text-sm text-gray-700 mt-0.5">{s.cols.net}: <b className="tabular-nums">{m.net || "0"} {m.unit}</b></p>
            <p className="text-xs text-gray-500 mt-1 flex flex-wrap items-center gap-1.5">
              {m.loc && (
                <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-1.5 py-0.5 text-gray-700" dir="ltr">
                  <MapPin size={11} />{m.loc}
                </span>
              )}
              {m.client && <span>{m.client}</span>}
              {m.forClient && <span className="text-gray-400">← {m.forClient}</span>}
            </p>
            {m.notes && <p className="text-xs text-gray-400 mt-1">{m.notes}</p>}
            {canWrite && (
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => onEdit(m)}
                  aria-label={editLabel}
                  className="min-w-11 min-h-11 inline-flex items-center justify-center rounded-lg text-gray-500 hover:text-blue-600 hover:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                >
                  <Pencil size={15} />
                </button>
                <button
                  onClick={() => onDelete(m)}
                  aria-label={deleteLabel}
                  className="min-w-11 min-h-11 inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {/* sm+: table */}
      <div className="hidden sm:block bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/50">
                {heads.map((c) => (
                  <th key={c.h} className={`${c.end ? "text-end" : "text-start"} px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap`}>{c.h}</th>
                ))}
                {canWrite && <th className="px-2 py-2.5" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((m) => (
                <tr key={`${m.log}-${m.num}`} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-gray-500 whitespace-nowrap" dir="ltr">{m.num}</td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{m.itemType}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{m.item}</td>
                  <td className="px-4 py-3 text-gray-600">{m.client || "—"}</td>
                  {hasForClient && <td className="px-4 py-3 text-gray-600">{m.forClient || "—"}</td>}
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                    {m.loc
                      ? <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-1.5 py-0.5 text-gray-700 text-xs" dir="ltr"><MapPin size={11} />{m.loc}</span>
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{m.date}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-gray-600 whitespace-nowrap">{m.qtyCount || "—"}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-gray-600 whitespace-nowrap">{m.qtyKg || "—"}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-gray-600 whitespace-nowrap">{m.loss || "0"}</td>
                  <td className="px-4 py-3 text-end tabular-nums font-semibold text-gray-900 whitespace-nowrap">{m.net || "0"} {m.unit}</td>
                  <td className="px-4 py-3 text-gray-400 max-w-[16rem] truncate">{m.notes}</td>
                  {canWrite && (
                    <td className="px-2 py-3 whitespace-nowrap">
                      <button
                        onClick={() => onEdit(m)}
                        aria-label={editLabel}
                        className="min-w-9 min-h-9 inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-blue-600 hover:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => onDelete(m)}
                        aria-label={deleteLabel}
                        className="min-w-9 min-h-9 inline-flex items-center justify-center rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
