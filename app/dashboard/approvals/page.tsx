"use client";
import { useEffect, useState, useCallback } from "react";
import { useLang } from "@/context/LangContext";
import { useAuth } from "@/context/AuthContext";
import { ad } from "@/lib/i18n.auth";
import { REQUESTABLE_ROLES, type Role } from "@/lib/roles";
import {
  listUsers, approveUser, rejectUser, setUserRole, setPending, type UserProfile,
} from "@/lib/users";
import { Pill, Btn, Spinner, EmptyState, inputCls } from "@/components/dashboard/ui";
import type { Tone } from "@/lib/prod-meta";

const statusTone = (s: string): Tone => (s === "approved" ? "green" : s === "rejected" ? "red" : "amber");

export default function ApprovalsPage() {
  const { lang } = useLang();
  const a = ad[lang];
  const isAr = lang === "ar";
  const { user } = useAuth();
  const [users, setUsers] = useState<UserProfile[] | null>(null);
  const [sel, setSel] = useState<Record<string, Role>>({});

  const load = useCallback(async () => {
    const list = await listUsers();
    setUsers(list);
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
  useEffect(() => { load(); }, [load]);

  async function approve(uid: string) { await approveUser(uid, sel[uid] ?? REQUESTABLE_ROLES[0]); load(); }
  async function reject(uid: string) { await rejectUser(uid); load(); }
  async function changeRole(uid: string, role: Role) { await setUserRole(uid, role); load(); }
  async function revoke(uid: string) { await setPending(uid); load(); }

  const statusLabel = (s: string) =>
    s === "approved" ? a.approvals.statusApproved : s === "rejected" ? a.approvals.statusRejected : a.approvals.statusPending;

  if (users === null) return <Spinner text={a.approvals.title} />;
  const pending = users.filter((u) => u.status === "pending");

  return (
    <div className="max-w-4xl" dir={isAr ? "rtl" : "ltr"}>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">{a.approvals.title}</h1>
      <p className="text-sm text-gray-500 mb-8">{a.approvals.subtitle}</p>

      {/* Pending queue */}
      <h2 className="font-semibold text-gray-900 mb-3">{a.approvals.pendingQueue}</h2>
      {pending.length === 0 ? (
        <EmptyState text={a.approvals.noPending} />
      ) : (
        <div className="space-y-3 mb-10">
          {pending.map((u) => (
            <div key={u.uid} className="bg-white border border-gray-200 rounded-xl px-5 py-4">
              <div className={`flex flex-wrap items-center justify-between gap-3 ${isAr ? "flex-row-reverse" : ""}`}>
                <div className={isAr ? "text-right" : ""}>
                  <p className="font-medium text-gray-900">{u.displayName || u.email}</p>
                  <p className="text-xs text-gray-500">
                    {u.email}
                    {u.requestedRole && u.requestedRole !== "owner"
                      ? ` · ${a.approvals.requested}: ${a.roles[u.requestedRole]}`
                      : ""}
                  </p>
                </div>
                <div className={`flex items-center gap-2 ${isAr ? "flex-row-reverse" : ""}`}>
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
      <h2 className="font-semibold text-gray-900 mb-3">{a.approvals.allUsers}</h2>
      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm" dir={isAr ? "rtl" : "ltr"}>
          <thead>
            <tr className="text-gray-500 border-b border-gray-100 text-xs uppercase tracking-wide">
              <th className="text-start font-medium px-4 py-3">{a.auth.email}</th>
              <th className="text-start font-medium px-4 py-3">{a.approvals.role}</th>
              <th className="text-start font-medium px-4 py-3">{a.approvals.status}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {users.map((u) => {
              const isSelf = u.uid === user?.uid;
              const isOwner = u.role === "owner";
              return (
                <tr key={u.uid} className="hover:bg-gray-50/60">
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
  );
}
