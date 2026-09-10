"use client";
import { usePageTitle } from "@/components/dashboard/use-page-title";
import { useEffect, useState, useCallback } from "react";
import { useLang } from "@/context/LangContext";
import { useAuth } from "@/context/AuthContext";
import { ad } from "@/lib/i18n.auth";
import { REQUESTABLE_ROLES, type Role } from "@/lib/roles";
import {
  listUsers, approveUser, rejectUser, setUserRole, setPending, type UserProfile,
} from "@/lib/users";
import { Pill, Btn, Spinner, EmptyState, inputCls } from "@/components/dashboard/ui";
import { pd } from "@/lib/i18n.prod";
import { readLastSeen, writeLastSeen, LOAD_TIMEOUT_MS } from "@/components/dashboard/last-seen";
import type { Tone } from "@/lib/prod-meta";

const statusTone = (s: string): Tone => (s === "approved" ? "green" : s === "rejected" ? "red" : "amber");

/** What this device saw last time — the list paints at once on the next open. */
const LAST_KEY = "itqan.approvals.last";

/**
 * The user list comes from the Firestore SDK, not a route, so `timedJson` does
 * not apply — but the failure mode was the same one every sheet page had: an
 * unresolved promise left the page spinning with no timeout and no error. A
 * lost connection or a denied read now becomes a visible line with a retry.
 */
function bounded<T>(work: Promise<T>, ms = LOAD_TIMEOUT_MS): Promise<{ ok: true; data: T } | { ok: false; timedOut: boolean }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, timedOut: true }), ms);
    work.then(
      (data) => { clearTimeout(timer); resolve({ ok: true, data }); },
      () => { clearTimeout(timer); resolve({ ok: false, timedOut: false }); },
    );
  });
}

export default function ApprovalsPage() {
  const { lang } = useLang();
  const a = ad[lang];
  const p = pd[lang];
  const isAr = lang === "ar";
  usePageTitle(a.approvals.title);
  const { user } = useAuth();
  const [users, setUsers] = useState<UserProfile[] | null>(null);
  const [sel, setSel] = useState<Record<string, Role>>({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<null | { timedOut: boolean }>(null);

  /** Seed the per-row role selects without clobbering a choice already made. */
  const seedSel = useCallback((list: UserProfile[]) => {
    setSel((prev) => {
      const next = { ...prev };
      for (const u of list) {
        if (!next[u.uid]) {
          next[u.uid] =
            u.requestedRole && u.requestedRole !== "owner"
              ? u.requestedRole
              : REQUESTABLE_ROLES[0];
        }
      }
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await bounded(listUsers());
    setLoading(false);
    // A failed read keeps whatever is on screen — an approval queue that
    // silently empties itself is worse than one that says it could not load.
    if (!r.ok) { setErr({ timedOut: r.timedOut }); return; }
    setUsers(r.data);
    setErr(null);
    seedSel(r.data);
    writeLastSeen(LAST_KEY, r.data);
  }, [seedSel]);

  useEffect(() => {
    const snap = readLastSeen<UserProfile[]>(LAST_KEY);
    if (Array.isArray(snap)) { setUsers(snap); seedSel(snap); }
    load();
  }, [load, seedSel]);

  async function approve(uid: string) { await approveUser(uid, sel[uid] ?? REQUESTABLE_ROLES[0]); load(); }
  async function reject(uid: string) { await rejectUser(uid); load(); }
  async function changeRole(uid: string, role: Role) { await setUserRole(uid, role); load(); }
  async function revoke(uid: string) { await setPending(uid); load(); }

  const statusLabel = (s: string) =>
    s === "approved" ? a.approvals.statusApproved : s === "rejected" ? a.approvals.statusRejected : a.approvals.statusPending;

  const errorLine = err ? (
    <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex flex-wrap items-center gap-3 text-sm text-red-700">
      <span>{err.timedOut ? p.common.timedOut : p.common.loadError}</span>
      <button
        onClick={load}
        className="inline-flex items-center min-h-11 sm:min-h-0 px-3 py-1.5 rounded-lg border border-red-300 bg-white text-red-700 hover:bg-red-100 active:bg-red-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
      >
        {p.common.retry}
      </button>
    </div>
  ) : null;

  if (users === null) {
    return (
      <div className="max-w-4xl" dir={isAr ? "rtl" : "ltr"}>
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">{a.approvals.title}</h1>
          <p className="text-sm text-gray-500">{a.approvals.subtitle}</p>
        </div>
        {errorLine}
        {!err && (
          <div className="flex justify-center py-16">
            <Spinner text={isAr ? "جارٍ التحميل…" : "Loading…"} />
          </div>
        )}
      </div>
    );
  }
  const pending = users.filter((u) => u.status === "pending");

  return (
    <div className="max-w-4xl" dir={isAr ? "rtl" : "ltr"}>
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">{a.approvals.title}</h1>
        <p className="text-sm text-gray-500">{a.approvals.subtitle}</p>
      </div>

      {errorLine}
      {/* A remembered list is on screen and the live one is still coming. */}
      {loading && !err && <p className="text-xs text-gray-400 mb-3">{p.common.stillLoading}</p>}

      {/* Pending queue */}
      <h2 className="text-sm font-semibold text-gray-900 mb-3">{a.approvals.pendingQueue}</h2>
      {pending.length === 0 ? (
        <EmptyState text={a.approvals.noPending} />
      ) : (
        <div className="space-y-3 mb-10">
          {pending.map((u) => (
            <div key={u.uid} className="bg-white border border-gray-200 rounded-xl px-4 sm:px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">{u.displayName || u.email}</p>
                  <p className="text-xs text-gray-500">
                    {u.email}
                    {u.requestedRole && u.requestedRole !== "owner"
                      ? ` · ${a.approvals.requested}: ${a.roles[u.requestedRole]}`
                      : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-gray-400">{a.approvals.asRole}</span>
                  <select
                    className={`${inputCls} w-auto`}
                    value={sel[u.uid] ?? REQUESTABLE_ROLES[0]}
                    onChange={(e) => setSel((s) => ({ ...s, [u.uid]: e.target.value as Role }))}
                  >
                    {REQUESTABLE_ROLES.map((r) => (
                      <option key={r} value={r}>{a.roles[r]}</option>
                    ))}
                  </select>
                  <Btn onClick={() => approve(u.uid)}>{a.approvals.approve}</Btn>
                  <Btn variant="danger" onClick={() => reject(u.uid)}>{a.approvals.reject}</Btn>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* All users */}
      <h2 className="text-sm font-semibold text-gray-900 mb-3">{a.approvals.allUsers}</h2>
      {/* Phone: one card per user. The table below carries four columns
          including a select and a button, which on a 375px screen means
          sideways scrolling to reach the control you came for. */}
      <div className="sm:hidden space-y-3">
        {users.map((u) => {
          const isSelf = u.uid === user?.uid;
          const isOwner = u.role === "owner";
          return (
            <div key={u.uid} className="bg-white border border-gray-200 rounded-xl px-4 py-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 truncate">
                    {u.displayName || u.email}
                    {isSelf ? <span className="text-xs text-gray-400"> ({a.approvals.you})</span> : null}
                  </div>
                  <div className="text-xs text-gray-400 truncate">{u.email}</div>
                </div>
                <Pill text={statusLabel(u.status)} tone={statusTone(u.status)} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {isOwner || isSelf ? (
                  <span className="text-sm text-gray-700">{u.role ? a.roles[u.role] : a.roles.none}</span>
                ) : (
                  <select
                    className={`${inputCls} w-auto`}
                    value={u.role && u.role !== "owner" ? u.role : REQUESTABLE_ROLES[0]}
                    onChange={(e) => changeRole(u.uid, e.target.value as Role)}
                  >
                    {REQUESTABLE_ROLES.map((r) => (
                      <option key={r} value={r}>{a.roles[r]}</option>
                    ))}
                  </select>
                )}
                {!isOwner && !isSelf && u.status === "approved" && (
                  <Btn variant="ghost" onClick={() => revoke(u.uid)}>{a.approvals.revoke}</Btn>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="hidden sm:block bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm" dir={isAr ? "rtl" : "ltr"}>
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/50">
              <th className="text-start px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{a.auth.email}</th>
              <th className="text-start px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{a.approvals.role}</th>
              <th className="text-start px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{a.approvals.status}</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((u) => {
              const isSelf = u.uid === user?.uid;
              const isOwner = u.role === "owner";
              return (
                <tr key={u.uid} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-3">
                    <span className="font-medium text-gray-900">{u.displayName || u.email}</span>
                    {isSelf ? <span className="text-xs text-gray-400"> ({a.approvals.you})</span> : null}
                    <span className="block text-xs text-gray-400">{u.email}</span>
                  </td>
                  <td className="px-4 py-3">
                    {isOwner || isSelf ? (
                      <span className="text-gray-700">{u.role ? a.roles[u.role] : a.roles.none}</span>
                    ) : (
                      <select
                        className={`${inputCls} w-auto`}
                        value={u.role && u.role !== "owner" ? u.role : REQUESTABLE_ROLES[0]}
                        onChange={(e) => changeRole(u.uid, e.target.value as Role)}
                      >
                        {REQUESTABLE_ROLES.map((r) => (
                          <option key={r} value={r}>{a.roles[r]}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Pill text={statusLabel(u.status)} tone={statusTone(u.status)} />
                  </td>
                  <td className="px-4 py-3 text-end">
                    {!isOwner && !isSelf && u.status === "approved" && (
                      <Btn variant="ghost" onClick={() => revoke(u.uid)}>{a.approvals.revoke}</Btn>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
