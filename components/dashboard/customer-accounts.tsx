"use client";
import { useCallback, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useLang } from "@/context/LangContext";
import { useAuth } from "@/context/AuthContext";
import { cp } from "@/lib/i18n.portal";
import { pd } from "@/lib/i18n.prod";
import {
  listCustomers, approveCustomer, rejectCustomer, revokeCustomer, setCustomerClients,
} from "@/lib/customers";
import type { ClientLink, CustomerAccount } from "@/lib/customer-link";
import { clientKey, clientNoOf } from "@/lib/customer-link";
import {
  MIN_PASSWORD, MAX_ALIASES, MAX_ALIAS_LENGTH,
  normalizeUsername, usernameIssue, usernameOf, passwordAdvice, generatePassword,
} from "@/lib/customer-login";
import { authedFetch } from "@/lib/authed-fetch";
import { bounded, timedJson } from "@/components/dashboard/last-seen";
import { useRemembered } from "@/components/dashboard/use-remembered";
import { Pill, Btn, Spinner, EmptyState, inputCls, LoadError, Modal } from "@/components/dashboard/ui";
import type { Tone } from "@/lib/prod-meta";

/**
 * «حسابات العملاء» — the section of /dashboard/approvals that links a portal
 * account to a row of «العملاء».
 *
 * This is the customer portal's ONE privileged screen. Everything a buyer can
 * see is decided here and nowhere else: the guard reads the link off the
 * account document and no portal route accepts a client name from the caller,
 * so a wrong pick here is the only way one company can see another's orders.
 *
 * Three things follow from that, and each is visible in the markup below:
 *
 *  - the company is CHOSEN from «العملاء», never typed. What the person wrote
 *    at sign-up is shown beside the picker as a hint and is labelled as such;
 *  - the aliases are the owner's, one spelling per chip, compared EXACTLY
 *    after digit/case/whitespace folding. «المصريه الذكيه للعدادات» on a work
 *    order and «المصرية الذكية» in «العملاء» are the same customer only
 *    because somebody says so here (lib/customer-link.ts);
 *  - a spelling that already folds to the chosen name is refused as a chip,
 *    so the list stays the list of DIFFERENCES and does not fill with noise.
 *
 * ── «إنشاء حساب عميل» (2026-10-07) ──────────────────────────────────────────
 * The owner makes a customer's login himself: a username and a password, the
 * SAME «العملاء» picker and alias chips as an approval, and one call to
 * `POST /api/customers`, which creates the account already linked. Two things
 * about that form are deliberate:
 *
 *  - the password is a VISIBLE text box. The owner is about to send it over
 *    WhatsApp; he has to read what he is sending;
 *  - the server never sends the password back, so the «تم إنشاء الحساب» panel
 *    shows it from this form's own state — and closing the panel throws it
 *    away. It is in no storage, no log and no URL at any point.
 */

type ClientRow = { row: number; no?: string; name?: string };
type ClientsPayload = { records: ClientRow[] };

const CUSTOMERS_KEY = "itqan.customers.last";
const CLIENTS_KEY = "itqan.customers.clients.last";

/**
 * The create form's slot in the per-account draft maps (`pick`, `aliases`,
 * `draft`) — it uses the same picker as an approval, so it uses the same
 * state. Not a possible Firebase uid.
 */
const NEW = "::new";

type CreateErrors = (typeof cp)["en"]["staff"]["create"]["errors"];
type Refusal = { reason: keyof CreateErrors; code: string };
type Created = {
  username: string;
  password: string;
  /** Set when the login exists but was not linked: the panel says where to finish. */
  warn: keyof CreateErrors | "";
};

/**
 * An integer in [0, n) from the browser's own generator, without the small
 * bias `% n` alone would carry. The password generator takes its random source
 * as an argument (lib/customer-login.ts) so that nothing can quietly fall back
 * to Math.random — this is the one it is given.
 */
function secureInt(n: number): number {
  const box = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / n) * n;
  do { crypto.getRandomValues(box); } while (box[0] >= limit);
  return box[0] % n;
}

const statusTone = (s: string): Tone => (s === "approved" ? "green" : s === "rejected" ? "red" : "amber");

export default function CustomerAccounts() {
  const { lang } = useLang();
  const c = cp[lang].staff;
  const p = pd[lang];
  const isAr = lang === "ar";
  const { user } = useAuth();

  // Draft link per account: the picked «العملاء» sheet row, plus its aliases.
  const [pick, setPick] = useState<Record<string, number>>({});
  const [aliases, setAliases] = useState<Record<string, string[]>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<Record<string, string>>({});

  // «إنشاء حساب عميل». The password lives HERE and nowhere else — component
  // state, gone when the dialog closes.
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUser, setNewUser] = useState("");
  const [newPass, setNewPass] = useState("");
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [copyState, setCopyState] = useState<"" | "copied" | "failed">("");
  const [closeAsked, setCloseAsked] = useState(false);
  /**
   * The username of an attempt that got NO ANSWER (a timeout, a dropped
   * connection). Such an attempt may have created the login all the same, so
   * if the next try with the SAME username and password is told «username
   * taken», the screen says that — instead of sending the owner to pick
   * another name and leave a login behind. Emptied when the password changes.
   */
  const [unanswered, setUnanswered] = useState("");

  const seed = useCallback((list: CustomerAccount[]) => {
    setAliases((prev) => {
      const next = { ...prev };
      for (const a of list) if (!next[a.uid]) next[a.uid] = a.clients[0]?.aliases ?? [];
      return next;
    });
  }, []);

  // `bounded` folds every rejection into one shape, but the one failure the
  // owner will actually meet first is Firestore answering permission-denied
  // because repo/firestore.rules has not been PUBLISHED yet (a git push does
  // not deploy rules). Remember that code beside the read so the banner can
  // say what to do instead of a generic "could not load".
  const [denied, setDenied] = useState(false);
  const { data: accounts, loading, failed, reload } = useRemembered<CustomerAccount[]>({
    key: CUSTOMERS_KEY,
    read: () => bounded(listCustomers().then(
      (list) => { setDenied(false); return list; },
      (e: unknown) => { setDenied((e as { code?: string })?.code === "permission-denied"); throw e; },
    )),
    valid: (snap) => Array.isArray(snap),
    hydrate: (snap) => { seed(snap); return snap; },
    onLoaded: seed,
  });

  // «العملاء» — a guarded read (contact data); owner and manager pass its
  // sales guard. The section still works from the device snapshot if it fails.
  const { data: clients, failed: clientsFailed, loading: clientsLoading, reload: reloadClients } = useRemembered<ClientsPayload>({
    key: CLIENTS_KEY,
    read: () => timedJson<ClientsPayload>(authedFetch, "/api/sheet/clients"),
    valid: (snap) => Array.isArray(snap?.records),
    worthRemembering: (next) => next.records.length > 0,
  });

  const clientRows = useMemo(
    () => (clients?.records ?? [])
      .filter((r) => (r.name ?? "").trim() && clientKey(r.name) !== "")
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "ar")),
    [clients],
  );
  const rowOf = useCallback(
    (row: number) => clientRows.find((r) => r.row === row),
    [clientRows],
  );

  function linkFor(uid: string): ClientLink | null {
    const r = rowOf(pick[uid] ?? -1);
    if (!r) return null;
    // `clientNoOf` is shared with POST /api/customers, which has to find this
    // same row on the sheet from the number sent here.
    return { no: clientNoOf(r.no), name: String(r.name ?? "").trim(), aliases: aliases[uid] ?? [] };
  }

  // The create form sends its aliases to the server, which refuses more than
  // MAX_ALIASES rather than drop one in silence — so the form stops at ten.
  const newAliasesFull = (aliases[NEW] ?? []).length >= MAX_ALIASES;

  function addAlias(uid: string) {
    const raw = (draft[uid] ?? "").trim();
    if (!raw) return;
    if (uid === NEW && newAliasesFull) return;
    const link = linkFor(uid);
    const k = clientKey(raw);
    // Nothing that folds to the canonical name, and no duplicate: the chip
    // list is the list of spellings that DIFFER, or it is noise.
    const same = link && clientKey(link.name) === k;
    const dup = (aliases[uid] ?? []).some((a) => clientKey(a) === k);
    if (!k || same || dup) { setDraft((s) => ({ ...s, [uid]: "" })); return; }
    if (uid === NEW) setRefusal(null);
    setAliases((s) => ({ ...s, [uid]: [...(s[uid] ?? []), raw] }));
    setDraft((s) => ({ ...s, [uid]: "" }));
  }

  function removeAlias(uid: string, at: number) {
    if (uid === NEW) setRefusal(null);
    setAliases((s) => ({ ...s, [uid]: (s[uid] ?? []).filter((_, i) => i !== at) }));
  }

  async function run(uid: string, work: () => Promise<void>) {
    setMsg((s) => ({ ...s, [uid]: "" }));
    try {
      await work();
      setEditing((s) => ({ ...s, [uid]: false }));
      reload();
    } catch {
      setMsg((s) => ({ ...s, [uid]: c.saveFailed }));
    }
  }

  const approve = (uid: string) => {
    const link = linkFor(uid);
    if (!link) { setMsg((s) => ({ ...s, [uid]: c.needClient })); return; }
    return run(uid, () => approveCustomer(uid, [link], user?.email ?? ""));
  };
  const saveLink = (uid: string) => {
    const link = linkFor(uid);
    if (!link) { setMsg((s) => ({ ...s, [uid]: c.needClient })); return; }
    return run(uid, () => setCustomerClients(uid, [link]));
  };

  const statusLabel = (s: string) =>
    s === "approved" ? c.statusApproved : s === "rejected" ? c.statusRejected : c.statusPending;

  /** The «العملاء» row + alias chips for one draft slot: an account's uid, or NEW. */
  function picker(id: string) {
    return (
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor={`client-${id}`}>
            {c.pickClient}
          </label>
          <select
            id={`client-${id}`}
            className={`${inputCls} w-full`}
            value={pick[id] ?? ""}
            onChange={(e) => {
              if (id === NEW) setRefusal(null);
              setPick((s) => ({ ...s, [id]: Number(e.target.value) }));
            }}
          >
            <option value="">{c.pickClientNone}</option>
            {clientRows.map((r) => (
              <option key={r.row} value={r.row}>{r.name}</option>
            ))}
          </select>
          <p className="text-xs text-gray-400 mt-1">{c.pickClientHint}</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor={`alias-${id}`}>
            {c.aliases}
          </label>
          <div className="flex flex-wrap gap-2 mb-2">
            {(aliases[id] ?? []).map((al, i) => (
              <span key={`${al}-${i}`} className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-700 rounded-full ps-2.5 pe-1 py-1">
                {al}
                <button
                  type="button"
                  onClick={() => removeAlias(id, i)}
                  aria-label={`${c.aliases}: ${al}`}
                  className="w-6 h-6 inline-flex items-center justify-center rounded-full hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              id={`alias-${id}`}
              className={`${inputCls} flex-1 min-w-40`}
              placeholder={c.aliasPlaceholder}
              maxLength={MAX_ALIAS_LENGTH}
              value={draft[id] ?? ""}
              onChange={(e) => setDraft((s) => ({ ...s, [id]: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAlias(id); } }}
            />
            <Btn type="button" variant="outline" disabled={id === NEW && newAliasesFull} onClick={() => addAlias(id)}>{c.aliasAdd}</Btn>
          </div>
          <p className="text-xs text-gray-400 mt-1 leading-relaxed">
            {id === NEW && newAliasesFull ? c.create.tooManyAliases : c.aliasHint}
          </p>
        </div>
      </div>
    );
  }

  /* ------------------------- «إنشاء حساب عميل» ------------------------- */

  const userIssue = usernameIssue(newUser);
  const advice = passwordAdvice(newPass);
  const newLink = linkFor(NEW);
  const canCreate =
    !sending && newName.trim().length > 0 && !!newLink &&
    userIssue === "ok" && newPass.length >= MIN_PASSWORD;

  /** Empty the form and the panel — the password with them. */
  function resetCreate() {
    setNewName(""); setNewUser(""); setNewPass("");
    setPick((s) => { const next = { ...s }; delete next[NEW]; return next; });
    setAliases((s) => ({ ...s, [NEW]: [] }));
    setDraft((s) => ({ ...s, [NEW]: "" }));
    setRefusal(null); setCreated(null); setCopyState(""); setCloseAsked(false); setSending(false);
    setUnanswered("");
  }

  function openCreate() { resetCreate(); setCreating(true); }

  /**
   * Every change to the password box. A refusal on screen was about what the
   * form held when it was sent, and the «most likely from your last attempt»
   * reading holds only for the password that attempt carried.
   */
  function changePass(next: string) {
    setRefusal(null);
    setUnanswered("");
    setNewPass(next);
  }

  /**
   * The ✕ and the backdrop. While the result is on screen and its details
   * have not been copied, a stray tap must not throw the password away — the
   * login would exist with a password nobody knows. It says so instead, and
   * «تم» closes whatever was or was not copied.
   */
  function dismissCreate() {
    if (sending) return;
    if (created && copyState !== "copied") { setCloseAsked(true); return; }
    finishCreate();
  }

  function finishCreate() {
    const made = !!created;
    setCreating(false);
    resetCreate();
    if (made) reload();
  }

  async function submitCreate() {
    if (!canCreate || !newLink) return;
    setRefusal(null);
    setSending(true);
    let res: Response;
    try {
      res = await authedFetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: newUser, password: newPass, displayName: newName.trim(), client: newLink,
        }),
      });
    } catch {
      // The request may have left before the connection dropped.
      setSending(false);
      setUnanswered(newUser);
      setRefusal({ reason: "network", code: "" });
      return;
    }
    const json = (await res.json().catch(() => null)) as
      | { ok?: boolean; reason?: string; error?: string; code?: string; stage?: string; username?: string }
      | null;
    setSending(false);
    if (res.ok && json?.ok) {
      setUnanswered("");
      setCreated({ username: json.username || newUser, password: newPass, warn: "" });
      return;
    }
    const reason = json?.reason ?? "";
    if (reason === "created_not_linked") {
      // The login EXISTS. The owner still has to hand it over, so he gets the
      // same panel — with the sentence that says where to finish the link.
      setUnanswered("");
      setCreated({
        username: newUser, password: newPass,
        warn: json?.stage === "doc" ? "created_not_linked_doc" : "created_not_linked",
      });
      return;
    }
    // No answer is not "nothing happened" (the route says so itself, and a
    // platform timeout arrives as a 5xx with no JSON at all): the login may
    // exist. The form — and the password in it — stays exactly as it is, and
    // the list behind it is read again.
    if (reason === "maybe_created" || (!json && res.status >= 500)) {
      setUnanswered(newUser);
      setRefusal({ reason: "maybe_created", code: "" });
      reload();
      return;
    }
    // «Taken» straight after an attempt that got no answer, same username and
    // same password: most likely that attempt's own login. Nothing is CLAIMED
    // — the sentence says how to find out.
    if (reason === "username_taken" && unanswered !== "" && unanswered === newUser) {
      setRefusal({ reason: "taken_after_no_answer", code: "" });
      return;
    }
    // An own-property check: "constructor" is `in` every object.
    const known = Object.prototype.hasOwnProperty.call(c.create.errors, reason)
      ? (reason as keyof CreateErrors)
      : null;
    setRefusal({
      reason: known ?? (res.status === 403 ? "forbidden" : "generic"),
      code: reason === "auth_failed" ? String(json?.code ?? "").slice(0, 60) : "",
    });
  }

  const portalLink = typeof window === "undefined" ? "/portal/login" : `${window.location.origin}/portal/login`;

  async function copyDetails() {
    if (!created) return;
    // The message is the customer's, so it is Arabic whatever language this
    // screen is in.
    const message = cp.ar.staff.create.copyText
      .replace("{link}", portalLink)
      .replace("{username}", created.username)
      .replace("{password}", () => created.password);
    try {
      await navigator.clipboard.writeText(message);
      setCopyState("copied");
      setCloseAsked(false);
    } catch {
      setCopyState("failed");
    }
  }

  const labelCls = "block text-xs font-medium text-gray-600 mb-1";
  const detailRow = (label: string, value: string) => (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="text-xs text-gray-500">{label}:</span>
      <bdi dir="ltr" className="text-sm font-medium text-gray-900 break-all select-all">{value}</bdi>
    </div>
  );

  const createDialog = (
    <Modal key="create-customer" open={creating} title={created ? (created.warn ? c.create.title : c.create.doneTitle) : c.create.title} onClose={dismissCreate} isAr={isAr}>
      {created ? (
        <div className="space-y-4">
          {/* Linked: the title says «تم إنشاء الحساب». Not linked: the login
              exists all the same, and this says where to finish it. */}
          {created.warn && (
            <p className="text-sm text-amber-700 leading-relaxed" role="alert">{c.create.errors[created.warn]}</p>
          )}
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 space-y-2">
            {detailRow(c.create.link, portalLink)}
            {detailRow(c.create.username, created.username)}
            {detailRow(c.create.password, created.password)}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Btn onClick={copyDetails}>{c.create.copy}</Btn>
            {copyState === "copied" && <span className="text-sm text-green-700" role="status">{c.create.copied}</span>}
            {copyState === "failed" && <span className="text-sm text-red-600" role="alert">{c.create.copyFailed}</span>}
          </div>
          <p className="text-xs text-gray-500 leading-relaxed">{c.create.separate}</p>
          {closeAsked && <p className="text-sm text-amber-700 leading-relaxed" role="alert">{c.create.closeWarn}</p>}
          <div className="flex justify-end">
            <Btn variant="outline" onClick={finishCreate}>{c.create.done}</Btn>
          </div>
        </div>
      ) : (
        <form
          noValidate
          onSubmit={(e) => { e.preventDefault(); void submitCreate(); }}
          className="space-y-4"
        >
          <p className="text-xs text-gray-500 leading-relaxed">{c.create.intro}</p>
          <div>
            <label className={labelCls} htmlFor="new-customer-name">{c.create.displayName}</label>
            <input
              id="new-customer-name" className={inputCls} autoComplete="off" maxLength={120}
              value={newName} onChange={(e) => { setRefusal(null); setNewName(e.target.value); }}
            />
          </div>

          {picker(NEW)}

          <div>
            <label className={labelCls} htmlFor="new-customer-username">{c.create.username}</label>
            <input
              id="new-customer-username" className={inputCls} dir="ltr" type="text" maxLength={30}
              autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              value={newUser}
              // Lower-cased as it is typed, so what the owner reads in the box
              // is exactly the username he will send.
              onChange={(e) => { setRefusal(null); setNewUser(normalizeUsername(e.target.value)); }}
            />
            <p className={`text-xs mt-1 leading-relaxed ${
              userIssue === "ok" ? "text-green-700" : userIssue === "empty" ? "text-gray-400" : "text-red-600"
            }`}>
              {userIssue === "ok" ? c.create.usernameOk : userIssue === "empty" ? c.create.usernameHint : c.create.userIssues[userIssue]}
            </p>
          </div>

          <div>
            <label className={labelCls} htmlFor="new-customer-password">{c.create.password}</label>
            <div className="flex gap-2">
              {/* A visible text box on purpose — see the note at the top. */}
              <input
                id="new-customer-password" className={`${inputCls} flex-1 min-w-0`} dir="ltr" type="text" maxLength={64}
                autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                value={newPass}
                // No spaces: it is read off one phone and typed on another, and
                // a space at the end of a message cannot be seen.
                onChange={(e) => changePass(e.target.value.replace(/\s/g, ""))}
              />
              <Btn type="button" variant="outline" onClick={() => changePass(generatePassword(secureInt))}>
                {c.create.generate}
              </Btn>
            </div>
            {newPass.length < MIN_PASSWORD ? (
              <p className="text-xs text-gray-400 mt-1">{c.create.passwordMin}</p>
            ) : advice !== "ok" ? (
              // Advice in amber — it never blocks the button below.
              <p className="text-xs text-amber-700 mt-1 leading-relaxed">
                {advice === "digitsOnly" ? c.create.adviceDigits : c.create.adviceShort}
              </p>
            ) : null}
          </div>

          {refusal && (
            <div role="alert">
              <p className="text-sm text-red-600 leading-relaxed">{c.create.errors[refusal.reason]}</p>
              {refusal.code && (
                <p className="text-[11px] text-gray-400 mt-0.5 break-all"><bdi dir="ltr">{refusal.code}</bdi></p>
              )}
            </div>
          )}
          {/* Nothing to choose from is not "you forgot to choose": say why,
              and offer the read again — the page's own banner is behind this
              sheet on a phone. */}
          {clientRows.length === 0 ? (
            clientsLoading && !clientsFailed ? (
              <p className="text-xs text-gray-400 leading-relaxed" role="status">{p.common.loading}</p>
            ) : (
              <LoadError variant="banner" text={c.clientsFailed} retry={p.common.retry} onRetry={reloadClients} loading={clientsLoading} />
            )
          ) : !canCreate && !sending && !refusal ? (
            <p className="text-xs text-gray-400 leading-relaxed">{c.create.missing}</p>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Btn type="button" variant="outline" disabled={sending} onClick={finishCreate}>{c.create.cancel}</Btn>
            <Btn type="submit" disabled={!canCreate}>{sending ? c.create.creating : c.create.submit}</Btn>
          </div>
        </form>
      )}
    </Modal>
  );

  const head = (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-gray-900">{c.title}</h2>
        <p className="text-xs text-gray-500">{c.subtitle}</p>
      </div>
      <Btn onClick={openCreate}>{c.create.open}</Btn>
    </div>
  );

  /**
   * The name an account is listed under. A login whose document was written by
   * the customer's first sign-in (not by the owner's form) has the made-up
   * address as its display name — that is shown as the username it stands for.
   */
  const titleOf = (a: CustomerAccount) =>
    usernameOf(a.displayName) || a.displayName || usernameOf(a.email) || a.email;

  /** How an account is named under its display name: a username, or its address. */
  const identity = (a: CustomerAccount) => {
    const u = usernameOf(a.email);
    return u ? <>{c.usernameLabel}: <bdi dir="ltr">{u}</bdi></> : a.email;
  };

  if (accounts === null) {
    return (
      <section className="mt-12" dir={isAr ? "rtl" : "ltr"}>
        {head}
        {failed ? (
          <LoadError
            variant="banner"
            text={failed.timedOut ? p.common.timedOut : denied ? c.rulesHint : p.common.loadError}
            retry={p.common.retry}
            onRetry={reload}
          />
        ) : (
          <div className="flex justify-center py-10"><Spinner text={p.common.loading} /></div>
        )}
        {createDialog}
      </section>
    );
  }

  const pending = accounts.filter((a) => a.status === "pending" && !a.approvedAt);
  const rest = accounts.filter((a) => !(a.status === "pending" && !a.approvedAt));

  return (
    <section className="mt-12" dir={isAr ? "rtl" : "ltr"}>
      {head}

      {failed && (
        <LoadError
          variant="banner"
          className="mb-4"
          text={failed.timedOut ? p.common.timedOut : denied ? c.rulesHint : p.common.loadError}
          retry={p.common.retry}
          onRetry={reload}
        />
      )}
      {clientsFailed && (
        <LoadError
          variant="banner"
          className="mb-4"
          text={c.clientsFailed}
          retry={p.common.retry}
          onRetry={reloadClients}
        />
      )}
      {loading && !failed && <p className="text-xs text-gray-400 mb-3">{p.common.stillLoading}</p>}

      <h3 className="text-xs font-semibold text-gray-500 mb-2">{c.pendingQueue}</h3>
      {pending.length === 0 ? (
        <EmptyState text={c.noPending} />
      ) : (
        <div className="space-y-3 mb-8">
          {pending.map((a) => (
            <div key={a.uid} className="bg-white border border-gray-200 rounded-xl px-4 sm:px-5 py-4">
              <div className="min-w-0 mb-3">
                <p className="font-medium text-gray-900 truncate">{titleOf(a)}</p>
                <p className="text-xs text-gray-500 truncate">{identity(a)}</p>
                {a.requestedClient && (
                  <p className="text-xs text-gray-400 mt-1">{c.typedCompany}: «{a.requestedClient}»</p>
                )}
              </div>
              {picker(a.uid)}
              {msg[a.uid] && <p className="text-sm text-red-600 mt-3">{msg[a.uid]}</p>}
              <div className="flex flex-wrap items-center gap-2 mt-4">
                <Btn onClick={() => approve(a.uid)}>{c.approve}</Btn>
                <Btn variant="danger" onClick={() => run(a.uid, () => rejectCustomer(a.uid))}>{c.reject}</Btn>
              </div>
            </div>
          ))}
        </div>
      )}

      <h3 className="text-xs font-semibold text-gray-500 mb-2">{c.allAccounts}</h3>
      {rest.length === 0 ? (
        <EmptyState text={c.noAccounts} />
      ) : (
        <div className="space-y-3">
          {rest.map((a) => {
            // Revoked reads as «منتظر» by status alone; `approvedAt` is what
            // says this account was open once and was stopped.
            const stopped = a.status === "rejected" || (a.status === "pending" && !!a.approvedAt);
            return (
              <div key={a.uid} className="bg-white border border-gray-200 rounded-xl px-4 sm:px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 truncate">{titleOf(a)}</p>
                    <p className="text-xs text-gray-400 truncate">{identity(a)}</p>
                    <p className="text-xs text-gray-600 mt-1">
                      {a.clients.length
                        ? `${c.linkedTo}: ${a.clients.map((x) => x.name).join(" · ")}`
                        : c.noLink}
                    </p>
                  </div>
                  <Pill text={stopped && a.status === "pending" ? c.statusRejected : statusLabel(a.status)} tone={stopped ? "red" : statusTone(a.status)} />
                </div>

                {editing[a.uid] && <div className="mt-4">{picker(a.uid)}</div>}
                {msg[a.uid] && <p className="text-sm text-red-600 mt-3">{msg[a.uid]}</p>}

                <div className="flex flex-wrap items-center gap-2 mt-4">
                  {editing[a.uid] ? (
                    <>
                      <Btn onClick={() => (a.status === "approved" ? saveLink(a.uid) : approve(a.uid))}>{c.save}</Btn>
                      <Btn variant="outline" onClick={() => setEditing((s) => ({ ...s, [a.uid]: false }))}>{c.cancel}</Btn>
                    </>
                  ) : (
                    <Btn
                      variant="outline"
                      onClick={() => {
                        // Open the editor on what the account already holds.
                        const cur = a.clients[0];
                        const row = cur ? clientRows.find((r) => clientKey(r.name) === clientKey(cur.name)) : undefined;
                        if (row) setPick((s) => ({ ...s, [a.uid]: row.row }));
                        setAliases((s) => ({ ...s, [a.uid]: cur?.aliases ?? [] }));
                        setEditing((s) => ({ ...s, [a.uid]: true }));
                      }}
                    >
                      {a.status === "approved" ? c.edit : c.approve}
                    </Btn>
                  )}
                  {a.status === "approved" && (
                    <Btn variant="danger" onClick={() => run(a.uid, () => revokeCustomer(a.uid))}>{c.revoke}</Btn>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {createDialog}
    </section>
  );
}
