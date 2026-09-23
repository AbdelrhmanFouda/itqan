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
import { clientKey } from "@/lib/customer-link";
import { authedFetch } from "@/lib/authed-fetch";
import { bounded, timedJson } from "@/components/dashboard/last-seen";
import { useRemembered } from "@/components/dashboard/use-remembered";
import { Pill, Btn, Spinner, EmptyState, inputCls, LoadError } from "@/components/dashboard/ui";
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
 */

type ClientRow = { row: number; no?: string; name?: string };
type ClientsPayload = { records: ClientRow[] };

const CUSTOMERS_KEY = "itqan.customers.last";
const CLIENTS_KEY = "itqan.customers.clients.last";

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
  const { data: clients, failed: clientsFailed, reload: reloadClients } = useRemembered<ClientsPayload>({
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
    const no = Number(String(r.no ?? "").replace(/[^\d]/g, ""));
    return { no: Number.isFinite(no) ? no : 0, name: String(r.name ?? "").trim(), aliases: aliases[uid] ?? [] };
  }

  function addAlias(uid: string) {
    const raw = (draft[uid] ?? "").trim();
    if (!raw) return;
    const link = linkFor(uid);
    const k = clientKey(raw);
    // Nothing that folds to the canonical name, and no duplicate: the chip
    // list is the list of spellings that DIFFER, or it is noise.
    const same = link && clientKey(link.name) === k;
    const dup = (aliases[uid] ?? []).some((a) => clientKey(a) === k);
    if (!k || same || dup) { setDraft((s) => ({ ...s, [uid]: "" })); return; }
    setAliases((s) => ({ ...s, [uid]: [...(s[uid] ?? []), raw] }));
    setDraft((s) => ({ ...s, [uid]: "" }));
  }

  function removeAlias(uid: string, at: number) {
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

  function picker(a: CustomerAccount) {
    return (
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor={`client-${a.uid}`}>
            {c.pickClient}
          </label>
          <select
            id={`client-${a.uid}`}
            className={`${inputCls} w-full`}
            value={pick[a.uid] ?? ""}
            onChange={(e) => setPick((s) => ({ ...s, [a.uid]: Number(e.target.value) }))}
          >
            <option value="">{c.pickClientNone}</option>
            {clientRows.map((r) => (
              <option key={r.row} value={r.row}>{r.name}</option>
            ))}
          </select>
          <p className="text-xs text-gray-400 mt-1">{c.pickClientHint}</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor={`alias-${a.uid}`}>
            {c.aliases}
          </label>
          <div className="flex flex-wrap gap-2 mb-2">
            {(aliases[a.uid] ?? []).map((al, i) => (
              <span key={`${al}-${i}`} className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-700 rounded-full ps-2.5 pe-1 py-1">
                {al}
                <button
                  type="button"
                  onClick={() => removeAlias(a.uid, i)}
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
              id={`alias-${a.uid}`}
              className={`${inputCls} flex-1 min-w-40`}
              placeholder={c.aliasPlaceholder}
              value={draft[a.uid] ?? ""}
              onChange={(e) => setDraft((s) => ({ ...s, [a.uid]: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAlias(a.uid); } }}
            />
            <Btn type="button" variant="outline" onClick={() => addAlias(a.uid)}>{c.aliasAdd}</Btn>
          </div>
          <p className="text-xs text-gray-400 mt-1 leading-relaxed">{c.aliasHint}</p>
        </div>
      </div>
    );
  }

  const head = (
    <div className="mb-3">
      <h2 className="text-sm font-semibold text-gray-900">{c.title}</h2>
      <p className="text-xs text-gray-500">{c.subtitle}</p>
    </div>
  );

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
                <p className="font-medium text-gray-900 truncate">{a.displayName || a.email}</p>
                <p className="text-xs text-gray-500 truncate">{a.email}</p>
                {a.requestedClient && (
                  <p className="text-xs text-gray-400 mt-1">{c.typedCompany}: «{a.requestedClient}»</p>
                )}
              </div>
              {picker(a)}
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
                    <p className="font-medium text-gray-900 truncate">{a.displayName || a.email}</p>
                    <p className="text-xs text-gray-400 truncate">{a.email}</p>
                    <p className="text-xs text-gray-600 mt-1">
                      {a.clients.length
                        ? `${c.linkedTo}: ${a.clients.map((x) => x.name).join(" · ")}`
                        : c.noLink}
                    </p>
                  </div>
                  <Pill text={stopped && a.status === "pending" ? c.statusRejected : statusLabel(a.status)} tone={stopped ? "red" : statusTone(a.status)} />
                </div>

                {editing[a.uid] && <div className="mt-4">{picker(a)}</div>}
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
    </section>
  );
}
