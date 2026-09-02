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
 * FINDING THINGS (2026-08-30). One text box over four fields was not enough for
 * a room 55 slots deep: «what is standing in A12» and «where is this item» were
 * both unanswerable. Search is Arabic-folded and multi-term, filters and a sort
 * apply to every tab, and the room is drawn the way the owner draws it
 * (components/dashboard/room-plan.tsx) — one tap on a place filters by it.
 *
 * EASY TO USE + EDIT INSIDE ANY PRODUCT (2026-09-02, owner's words). The two
 * verbs a storekeeper has — إيداع and سحب — are the two big buttons; everything
 * else stepped back. The stat tiles filter. The filter selects fold away on a
 * phone. And every line of the balance OPENS (components/dashboard/storage-item.tsx):
 * its movements, each editable; deposit here / withdraw from here / move to
 * another place; the same item elsewhere; and two honesty checks — the
 * movements summed against the sheet's figure, and a negative line paired with
 * the pile it was almost certainly meant to draw from.
 *
 * Two things measured on the live bridge that day shaped the logic below:
 *   - dates arrive as «9/2/2026 13:56:27» or «2026-09-02» (and once as «A17»);
 *     handing the raw cell to <input type=date> blanked it, and the bridge then
 *     stamped TODAY on any movement edited from the site. storageDate() fixes it.
 *   - the deployed bridge is v3, whose available_() matches the location cell
 *     EXACTLY: a blank location on a سحب means the line filed without a place,
 *     not "every place". The form's «المتوفر» says the same thing the bridge
 *     will check, or the two disagree about the same withdrawal.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "@/context/LangContext";
import { useAuth } from "@/context/AuthContext";
import { authedFetch } from "@/lib/authed-fetch";
import { sd } from "@/lib/i18n.storage";
import { hasFullAccess } from "@/lib/roles";
import {
  NO_LOCATION, buildFloorPlan, collectLocations, compareLocKey, historyFor, locKey,
  matchesTerms, movePayloads, sameLine, sameLocation, sameOwnerItem, searchTerms,
  storageDate, sumNet, toNumber as num, whereIs, type LocationStat,
} from "@/lib/storage-filter";
import { Btn, EmptyState, Field, inputCls, Modal, Spinner } from "@/components/dashboard/ui";
import { FilteredEmpty, RoomPlan } from "@/components/dashboard/room-plan";
import { ItemDrawer, MoveModal, type MoveHalf, type MoveRequest } from "@/components/dashboard/storage-item";
import {
  ArrowDownToLine, ArrowUpFromLine, ChevronDown, ChevronUp, ChevronRight, ExternalLink,
  ListRestart, MapPin, Pencil, RefreshCw, Search, SlidersHorizontal, Trash2, X,
} from "lucide-react";
import type { StorageBalance, StorageData, StorageMovement } from "@/lib/storage";

const SHEET_URL = "https://docs.google.com/spreadsheets/d/1jmPjBFMCcoZmaVeLUD_wLCRtat3RCQ2c7c_UVtsW4gw/edit";
const MAP_KEY = "itqan.storage.map"; // remembered open/closed state of the room

type Tab = "balance" | "in" | "out";
type Sort = "sheet" | "item" | "loc" | "avail";
type Status = "" | "in" | "zero" | "neg";
type ItemType = "" | "منتج" | "خامة";
type MoveType = "إيداع" | "سحب";

const todayStr = () => new Date().toLocaleDateString("en-CA"); // yyyy-mm-dd, local tz
/** The sheet writes «خامة»/«منتج»; be tolerant of a stray «خامات» or a space. */
const isMaterial = (t: string | undefined) => String(t ?? "").trim().startsWith("خام");
const r2 = (n: number) => Math.round(n * 100) / 100;
const fill = (t: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), t);

type FormState = {
  moveType: MoveType;
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
  const fmtN = useCallback((n: number) => n.toLocaleString(isAr ? "ar-EG" : "en-US"), [isAr]);

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
  const [filtersOpen, setFiltersOpen] = useState(false); // phones only — sm+ always shows them
  // Remembered preference. Read in the initializer, not an effect: the map only
  // renders once `data` has loaded client-side, so a server/client difference
  // here can never reach the DOM as a hydration mismatch.
  const [mapOpen, setMapOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(MAP_KEY) !== "0"; } catch { return true; }
  });

  // a stock line, opened
  const [openLine, setOpenLine] = useState<StorageBalance | null>(null);
  const [moveLine, setMoveLine] = useState<StorageBalance | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);
  const [moveErr, setMoveErr] = useState("");
  const [moveHalf, setMoveHalf] = useState<MoveHalf | null>(null);

  // movement modal
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<StorageMovement | null>(null); // null = add
  const [form, setForm] = useState<FormState>(blankForm());
  const [itemQuery, setItemQuery] = useState("");
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

  const toggleMap = () => setMapOpen((v) => {
    try { localStorage.setItem(MAP_KEY, v ? "0" : "1"); } catch { /* private mode */ }
    return !v;
  });

  const flash = (msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 6000);
  };

  type PostResult = { ok: boolean; num?: string; nums?: string[]; split?: boolean; message?: string; error?: string };
  async function post(payload: Record<string, unknown>): Promise<PostResult> {
    const token = user ? await user.getIdToken() : "";
    const res = await fetch("/api/storage", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    return (await res.json().catch(() => ({ ok: false, error: "bad_response" }))) as PostResult;
  }

  /* ------------------------------ derived ------------------------------ */

  const lists = data?.lists;
  // What the DEPLOYED bridge can actually do — measured, not assumed. The live
  // deployment was still v3 on 2026-09-02, so both of these are false there and
  // the page must not offer what the sheet would drop on the floor.
  const hasForClient = data?.supportsForClient ?? false;
  // v4 is also where a blank location on a سحب started meaning "every place"
  // (auto-allocation, oldest deposit first). v3's available_() matches the
  // location cell exactly, so blank means the line filed WITHOUT a place.
  const blankLocMeansAll = hasForClient;
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
  // every place the form and the move can name (the sheet's own spelling)
  const placeNames = useMemo(
    () => locStats.filter((l) => l.key !== NO_LOCATION).map((l) => l.label),
    [locStats],
  );

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
        matchesTerms([m.num, m.item, m.client, m.forClient, m.loc, storageDate(m.date), m.date, m.notes], terms))
      .reverse(),
    [movements, locFilter, typeOk, terms],
  );

  const shownCount = tab === "balance" ? balance.length : shownMovements.length;
  const totalCount = tab === "balance" ? allBalance.length : movements.length;
  const activeFilters = [locFilter, typeFilter, statusFilter].filter(Boolean).length;
  const filtered = Boolean(search) || activeFilters > 0;
  const negatives = useMemo(() => allBalance.filter((b) => num(b.avail) < 0).length, [allBalance]);
  const unfiled = useMemo(() => allBalance.filter((b) => !locKey(b.loc)).length, [allBalance]);

  function clearFilters() {
    setSearch("");
    setLocFilter("");
    setTypeFilter("");
    setStatusFilter("");
  }

  // the opened line, kept fresh across the 20s refresh so its figure moves
  const liveLine = useMemo(
    () => (openLine ? allBalance.find((b) => sameLine(b, openLine)) ?? openLine : null),
    [openLine, allBalance],
  );

  /* --------------------------- form-side derived --------------------------- */

  const itemOptions = useMemo(() => {
    const all = form.itemType === "خامة" ? lists?.materials ?? [] : lists?.products ?? [];
    const t = searchTerms(itemQuery);
    const shown = t.length ? all.filter((o) => matchesTerms([o], t)) : all;
    // the value being edited must stay selectable whatever was typed
    return form.item && !shown.includes(form.item) ? [form.item, ...shown] : shown;
  }, [form.itemType, form.item, lists, itemQuery]);

  // live computed fields — mirrors the sheet form's compute_() exactly
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

  // What the bridge will check a سحب against: the MOVEMENTS summed on the same
  // four exact keys — not the balance tab's column, which available_() never
  // reads and which can be overwritten by hand (it was, on 2026-09-02).
  const avail = useMemo(() => {
    if (!form.item || !data) return null;
    const line = { itemType: form.itemType, item: form.item, client: form.client, loc: form.loc.trim() };
    if (!line.loc && blankLocMeansAll) {
      return { qty: sumNet(allMovements.filter((m) => sameOwnerItem(m, line))), scope: "all" as const };
    }
    return { qty: sumNet(historyFor(allMovements, line)), scope: line.loc ? ("here" as const) : ("none" as const) };
  }, [data, allMovements, form.item, form.itemType, form.client, form.loc, blankLocMeansAll]);
  // ...and what can leave the line being moved, for the same reason
  const moveAvail = useMemo(
    () => (moveLine ? sumNet(historyFor(allMovements, moveLine)) : 0),
    [moveLine, allMovements],
  );

  // The form offers every place the room names, plus the value the row being
  // edited already carries — EXACT match, not locKey(): the sheet keys stock on
  // the string as typed, so a row standing at the stale lowercase `a12` must
  // stay selectable as `a12`, or withdrawing from `A12` is refused for no balance.
  const formLocations = useMemo(() => {
    const opts = [...placeNames];
    const cur = form.loc.trim();
    if (cur && !opts.includes(cur)) opts.push(cur);
    return opts;
  }, [placeNames, form.loc]);
  const locIsUnknown = Boolean(
    form.loc.trim() && !locStats.some((l) => l.key === locKey(form.loc)),
  );

  /* ------------------------------ actions ------------------------------ */

  /** Open the movement form for a deposit or a withdrawal, optionally already
   *  standing on a line (from the drawer) or a place (from the map filter). */
  function openAdd(moveType: MoveType, line?: StorageBalance) {
    setEditing(null);
    setItemQuery("");
    const pre = !line && locStats.find((l) => l.key === locFilter && l.key !== NO_LOCATION);
    setForm({
      ...blankForm(),
      moveType,
      ...(line
        ? {
            itemType: isMaterial(line.itemType) ? "خامة" : "منتج",
            item: line.item, client: line.client, loc: line.loc,
            grams: !isMaterial(line.itemType) && lists?.weights?.[line.item] ? String(lists.weights[line.item]) : "",
          }
        : { loc: pre ? pre.label : "" }),
    });
    setFormErr("");
    setOpen(true);
  }

  function openEdit(m: StorageMovement) {
    setEditing(m);
    setItemQuery("");
    setForm({
      moveType: m.log,
      itemType: isMaterial(m.itemType) ? "خامة" : "منتج",
      item: m.item, client: m.client, forClient: m.forClient, loc: m.loc,
      // the raw cell («9/2/2026 13:56:27») is not a value <input type=date>
      // accepts; an unparseable one is left EMPTY so the save asks for it
      // instead of the bridge quietly stamping today
      date: storageDate(m.date),
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
    if (!form.date) { setFormErr(s.form.needDate); return; }
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

  /** A move is two bridge calls, and the bridge is at-least-once with no
   *  transaction across calls. So: withdraw first (that is the one the sheet
   *  can REFUSE, on balance), and if the deposit then fails, stop and show
   *  exactly what landed — with an undo — rather than retrying blind. */
  async function handleMove(req: MoveRequest) {
    if (!moveLine) return;
    setMoveBusy(true);
    setMoveErr("");
    const grams = !isMaterial(moveLine.itemType) ? Number(lists?.weights?.[moveLine.item]) || undefined : undefined;
    const [out, inn] = movePayloads(moveLine, req.toLoc, req.qty, req.date, req.notes, grams);
    const r1 = await post(out);
    if (!r1.ok) { setMoveBusy(false); setMoveErr(r1.error || "error"); return; }
    const r2 = await post(inn);
    setMoveBusy(false);
    if (!r2.ok) { setMoveHalf({ out: r1.num ?? "?", error: r2.error || "error" }); load(); return; }
    setMoveLine(null);
    flash(fill(s.move.done, { out: r1.num ?? "?", in: r2.num ?? "?" }));
    load();
  }

  async function handleUndoMove(outNum: string) {
    setMoveBusy(true);
    const res = await post({ action: "delete", log: "سحب", num: outNum });
    setMoveBusy(false);
    if (!res.ok) { setMoveErr(res.error || "error"); return; }
    setMoveHalf(null);
    setMoveLine(null);
    flash(s.move.undone);
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
  const iconBtn =
    "inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-2 min-h-11 sm:min-h-0 rounded-lg text-sm text-gray-600 " +
    "hover:bg-gray-100 active:bg-gray-200 transition-colors focus-visible:outline-none focus-visible:ring-2 " +
    "focus-visible:ring-blue-500/40 focus-visible:ring-offset-1";
  const bigBtn =
    "flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-5 py-2.5 min-h-12 sm:min-h-10 rounded-xl " +
    "text-base sm:text-sm font-semibold text-white shadow-sm transition-colors focus-visible:outline-none " +
    "focus-visible:ring-2 focus-visible:ring-offset-1";
  const activeLoc = locStats.find((l) => l.key === locFilter);

  return (
    <div dir={isAr ? "rtl" : "ltr"}>
      <div className="mb-5 sm:mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">{s.title}</h1>
        <p className="text-sm text-gray-500">{s.subtitle}</p>
        {/* The two verbs, big; everything else small. Always flex-wrap. */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {canWrite && (
            <>
              <button
                onClick={() => openAdd("إيداع")}
                className={`${bigBtn} bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 focus-visible:ring-emerald-500/40`}
              >
                <ArrowDownToLine size={18} /> {s.actions.deposit}
              </button>
              <button
                onClick={() => openAdd("سحب")}
                className={`${bigBtn} bg-orange-500 hover:bg-orange-400 active:bg-orange-600 focus-visible:ring-orange-500/40`}
              >
                <ArrowUpFromLine size={18} /> {s.actions.withdraw}
              </button>
            </>
          )}
          <div className="flex items-center gap-0.5 ms-auto">
            <button onClick={load} className={iconBtn} title={s.refresh} aria-label={s.refresh}>
              <RefreshCw size={15} /><span className="hidden sm:inline">{s.refresh}</span>
            </button>
            {canWrite && (
              <>
                <button onClick={handleRefreshLists} className={iconBtn} title={s.refreshLists} aria-label={s.refreshLists}>
                  <ListRestart size={15} /><span className="hidden sm:inline">{s.refreshLists}</span>
                </button>
                <a href={SHEET_URL} target="_blank" rel="noreferrer" className={iconBtn} title={s.openSheet} aria-label={s.openSheet}>
                  <ExternalLink size={15} /><span className="hidden sm:inline">{s.openSheet}</span>
                </a>
              </>
            )}
          </div>
        </div>
      </div>

      {notice && (
        <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-4 inline-block">
          {notice}
        </p>
      )}
      {loadErr && <p className="text-xs text-amber-600 mb-3">{s.loadError}</p>}
      {!canWrite && <p className="text-xs text-gray-400 mb-3">{s.readOnly}</p>}

      {/* stat tiles that filter */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-1">
        <StatTile label={s.stats.items} value={fmtN(allBalance.length)} active={tab === "balance" && !filtered}
          onClick={() => { setTab("balance"); clearFilters(); }} />
        <StatTile label={s.stats.unfiled} value={fmtN(unfiled)} active={locFilter === NO_LOCATION}
          onClick={() => setLocFilter(locFilter === NO_LOCATION ? "" : NO_LOCATION)} />
        <StatTile label={s.stats.negative} value={fmtN(negatives)} tone={negatives > 0 ? "red" : "green"}
          active={statusFilter === "neg"}
          onClick={() => { setTab("balance"); setStatusFilter(statusFilter === "neg" ? "" : "neg"); }} />
        <StatTile label={s.stats.movements} value={fmtN(data.inLog.length + data.outLog.length)} />
      </div>
      <p className="text-[11px] text-gray-400 mb-4">{s.statsHint}</p>

      {/* ----------------------------- controls ----------------------------- */}
      <div className="space-y-3 mb-4">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {tabs.length > 1 && (
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
          )}
          <div className="relative flex-1 min-w-[12rem] sm:max-w-sm">
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
          {/* phones: the selects fold away behind this */}
          <button
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
            className={`sm:hidden inline-flex items-center gap-1.5 px-3 min-h-11 rounded-lg border text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
              activeFilters ? "border-blue-400 text-blue-700 bg-blue-50" : "border-gray-300 text-gray-700 bg-white"
            }`}
          >
            <SlidersHorizontal size={15} /> {s.filters.toggle}
            {activeFilters > 0 && <span className="tabular-nums text-xs rounded-full bg-blue-600 text-white px-1.5">{activeFilters}</span>}
          </button>
        </div>

        <div className={`${filtersOpen ? "flex" : "hidden sm:flex"} flex-wrap items-center gap-2`}>
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
            {fill(s.filters.showing, { n: fmtN(shownCount), total: fmtN(totalCount) })}
          </span>
        </div>

        {/* ------------------------- the room, tappable ------------------------- */}
        {locStats.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl">
            <button
              onClick={toggleMap}
              aria-expanded={mapOpen}
              className="w-full flex items-center gap-2 px-4 py-3 min-h-11 text-sm font-medium text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 rounded-xl"
            >
              <MapPin size={15} className="text-gray-400" />
              {s.filters.map}
              <span className="text-xs text-gray-400 tabular-nums">
                {locStats.filter((l) => l.key !== NO_LOCATION).length}
              </span>
              {activeLoc && (
                <span className="text-xs font-normal text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5 truncate max-w-[9rem]">
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
          : <BalanceView rows={balance} s={s} onOpen={setOpenLine} />
      ) : (
        shownMovements.length === 0 && filtered
          ? <FilteredEmpty text={s.noMatch} label={s.filters.clear} onClear={clearFilters} />
          : <MovementsView rows={shownMovements} s={s} isAr={isAr} canWrite={canWrite} hasForClient={hasForClient} onEdit={openEdit} onDelete={handleDelete} />
      )}

      {/* ------------------------------ a line, opened ------------------------------ */}
      <ItemDrawer
        line={liveLine}
        balance={allBalance}
        movements={allMovements}
        canWrite={canWrite}
        isAr={isAr}
        s={s}
        onClose={() => setOpenLine(null)}
        onDeposit={(l) => openAdd("إيداع", l)}
        onWithdraw={(l) => openAdd("سحب", l)}
        onMove={(l) => { setMoveErr(""); setMoveHalf(null); setMoveLine(l); }}
        onEdit={openEdit}
        onDelete={handleDelete}
        onSwitch={setOpenLine}
      />
      <MoveModal
        key={moveLine ? `${moveLine.itemType}|${moveLine.item}|${moveLine.client}|${moveLine.loc}` : "none"}
        line={moveLine}
        avail={moveAvail}
        locations={placeNames}
        strict={strictLocations}
        isAr={isAr}
        s={s}
        busy={moveBusy}
        error={moveErr}
        half={moveHalf}
        onClose={() => { if (!moveBusy) { setMoveLine(null); setMoveHalf(null); setMoveErr(""); } }}
        onConfirm={handleMove}
        onUndo={handleUndoMove}
      />

      {/* ------------------------------ the movement form ------------------------------ */}
      <Modal open={open} title={editing ? `${s.form.editTitle} — ${editing.num}` : (form.moveType === "سحب" ? s.moveTypes.out : s.moveTypes.in)} onClose={() => setOpen(false)} isAr={isAr}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
          <Field label={s.form.moveType}>
            <select
              className={inputCls}
              value={form.moveType}
              disabled={!!editing}
              onChange={(e) => setForm((f) => ({ ...f, moveType: e.target.value as MoveType }))}
            >
              <option value="إيداع">{s.moveTypes.in}</option>
              <option value="سحب">{s.moveTypes.out}</option>
            </select>
          </Field>
          <Field label={s.form.itemType}>
            <select
              className={inputCls}
              value={form.itemType}
              onChange={(e) => {
                setItemQuery("");
                setForm((f) => ({ ...f, itemType: e.target.value as FormState["itemType"], item: "", grams: "" }));
              }}
            >
              <option value="منتج">{s.itemTypes.product}</option>
              <option value="خامة">{s.itemTypes.material}</option>
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label={s.form.item}>
              <>
                {/* 469 products in one dropdown is unusable on a phone: type to narrow,
                    pick from the (still strict) list — a typo must not create a new line */}
                <input
                  value={itemQuery}
                  onChange={(e) => setItemQuery(e.target.value)}
                  placeholder={s.form.itemSearch}
                  className={`${inputCls} mb-1.5`}
                />
                <select className={inputCls} value={form.item} onChange={(e) => pickItem(e.target.value)} size={itemQuery ? Math.min(6, Math.max(2, itemOptions.length)) : undefined}>
                  <option value="">{s.form.selectItem}</option>
                  {itemOptions.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </>
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
                          locKey(w.loc) === locKey(form.loc) && (w.loc || !form.loc)
                            ? "border-blue-600 bg-blue-600 text-white"
                            : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        <span dir={w.loc ? "ltr" : undefined}>{w.loc || s.filters.noLocation}</span> <b>{w.qty}</b> <span className="opacity-70">{w.unit}</span>
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
                    placeholder={s.filters.noLocation}
                  />
                  <datalist id="storage-locations">
                    {formLocations.map((o) => <option key={o} value={o} />)}
                  </datalist>
                </>
              )}
            </Field>
            {locIsUnknown && <p className="-mt-2 mb-3 text-xs text-amber-600">{s.form.locUnknown}</p>}
            {form.moveType === "سحب" && !form.loc.trim() && (
              <p className="-mt-2 mb-3 text-xs text-gray-400">{blankLocMeansAll ? s.form.locOutHint : s.form.locOutHintV3}</p>
            )}
          </div>
          <Field label={s.form.date}>
            <input type="date" className={inputCls} value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
          </Field>
          {editing && !form.date && (
            <p className="sm:col-span-2 -mt-2 mb-3 text-xs text-amber-600">{fill(s.badDate, { raw: editing.date || "—" })}</p>
          )}
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
              <b className={form.moveType === "سحب" && net > avail.qty + 1e-9 ? "text-red-600" : ""}>{avail.qty} {unit}</b>
              {avail.scope === "all" && <span className="text-gray-400"> — {s.form.availAll}</span>}
              {avail.scope === "none" && <span className="text-gray-400"> — {s.form.availNone}</span>}
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

/* --------------------------------- pieces --------------------------------- */

/** A number that is also a filter. Plain when it has no onClick. */
function StatTile({
  label, value, tone, active, onClick,
}: {
  label: string; value: string; tone?: "red" | "green"; active?: boolean; onClick?: () => void;
}) {
  const valueCls = tone === "red" ? "text-red-600" : tone === "green" ? "text-emerald-700" : "text-gray-900";
  const box = `text-start bg-white border rounded-xl px-3 py-2.5 sm:px-4 sm:py-3 transition-colors ${
    active ? "border-blue-400 ring-2 ring-blue-500/20" : "border-gray-200"
  }`;
  const inner = (
    <>
      <p className="text-[11px] sm:text-xs text-gray-500 truncate">{label}</p>
      <p className={`text-xl sm:text-2xl font-bold tracking-tight tabular-nums ${valueCls}`}>{value}</p>
    </>
  );
  if (!onClick) return <div className={box}>{inner}</div>;
  return (
    <button onClick={onClick} aria-pressed={active} className={`${box} hover:bg-gray-50 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40`}>
      {inner}
    </button>
  );
}

/* ------------------------------ balance view ------------------------------ */

function BalanceView({
  rows, s, onOpen,
}: {
  rows: StorageBalance[];
  s: (typeof sd)["en"] | (typeof sd)["ar"];
  onOpen: (b: StorageBalance) => void;
}) {
  if (rows.length === 0) return <EmptyState text={s.empty} />;
  const availCls = (v: string) =>
    num(v) < 0 ? "text-red-600" : num(v) === 0 ? "text-gray-400" : "text-emerald-700";
  const heads: { h: string; end?: boolean }[] = [
    { h: s.cols.itemType }, { h: s.cols.item }, { h: s.cols.client }, { h: s.cols.loc },
    { h: s.cols.avail, end: true }, { h: s.cols.inQty, end: true }, { h: s.cols.inLast },
    { h: s.cols.outQty, end: true }, { h: s.cols.outLast }, { h: s.cols.loss, end: true },
  ];
  const place = (b: StorageBalance) => b.loc
    ? <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-1.5 py-0.5 text-gray-700 text-xs" dir="ltr"><MapPin size={11} />{b.loc}</span>
    : <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-amber-700 text-xs"><MapPin size={11} />{s.filters.noLocation}</span>;
  return (
    <>
      <p className="text-[11px] text-gray-400 mb-2">{s.tapRow}</p>
      {/* phones: cards */}
      <div className="sm:hidden space-y-2">
        {rows.map((b, i) => (
          <button
            key={i}
            onClick={() => onOpen(b)}
            className="w-full text-start bg-white border border-gray-200 rounded-xl p-4 hover:bg-gray-50 active:bg-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          >
            <div className="flex items-center justify-between gap-3 min-w-0 mb-1">
              <p className="font-medium text-gray-900 min-w-0 truncate">{b.item}</p>
              <span className="shrink-0 text-xs text-gray-400 whitespace-nowrap">{b.itemType}</span>
            </div>
            <div className="flex items-end justify-between gap-3">
              <p className={`text-lg font-bold tabular-nums ${availCls(b.avail)}`}>{b.avail || "0"} {b.unit}</p>
              <ChevronRight size={16} className="text-gray-300 rtl:-scale-x-100" />
            </div>
            <p className="text-xs text-gray-500 mt-1 flex flex-wrap items-center gap-1.5">
              {place(b)}
              {b.client && <span>{b.client}</span>}
            </p>
          </button>
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
                <th className="px-2 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((b, i) => (
                <tr
                  key={i}
                  onClick={() => onOpen(b)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(b); } }}
                  tabIndex={0}
                  className="hover:bg-blue-50/40 transition-colors cursor-pointer focus-visible:outline-none focus-visible:bg-blue-50/60"
                >
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{b.itemType}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{b.item}</td>
                  <td className="px-4 py-3 text-gray-600">{b.client || "—"}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{place(b)}</td>
                  <td className={`px-4 py-3 text-end tabular-nums font-bold whitespace-nowrap ${availCls(b.avail)}`}>{b.avail || "0"} {b.unit}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-gray-600 whitespace-nowrap">{b.inQty || "0"}</td>
                  <td className="px-4 py-3 text-gray-400 whitespace-nowrap" dir="ltr">{storageDate(b.inLast) || b.inLast || "—"}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-gray-600 whitespace-nowrap">{b.outQty || "0"}</td>
                  <td className="px-4 py-3 text-gray-400 whitespace-nowrap" dir="ltr">{storageDate(b.outLast) || b.outLast || "—"}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-gray-600 whitespace-nowrap">{b.loss || "0"}</td>
                  <td className="px-2 py-3 text-gray-300"><ChevronRight size={15} className="rtl:-scale-x-100" /></td>
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
  // the sheet's cell in one shape; a cell that is not a date says so, in amber
  const when = (m: StorageMovement) => {
    const iso = storageDate(m.date);
    return iso
      ? <span dir="ltr">{iso}</span>
      : <span className="text-amber-600" title={fill(s.badDate, { raw: m.date || "—" })}>⚠ {m.date || "—"}</span>;
  };
  return (
    <>
      {/* phones: cards */}
      <div className="sm:hidden space-y-3">
        {rows.map((m) => (
          <div key={`${m.log}-${m.num}`} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center justify-between gap-3 min-w-0 mb-1">
              <p className="font-mono text-xs text-gray-500 min-w-0 truncate" dir="ltr">{m.num}</p>
              <span className="shrink-0 text-xs text-gray-400">{when(m)}</span>
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
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{when(m)}</td>
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
