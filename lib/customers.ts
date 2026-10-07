"use client";
/**
 * Customer-account data layer (client SDK, so it runs AUTHENTICATED in the
 * browser and firestore.rules on `customers` apply).
 *
 * Every write here is an owner/manager action from /dashboard/approvals. The
 * rules allow update to an admin alone, so none of these functions can be
 * reached by the account they describe — which is the whole point: `clients`
 * is the access link, and a buyer linking themselves is the one failure this
 * design does not permit.
 *
 * The reads are the same collection from the other side: `watchCustomer(uid)`
 * is what the portal shell subscribes to, and it is allowed because the rule
 * lets an account read its OWN document. A revoked account sees the closed
 * card the moment the snapshot lands, without waiting for its next API call.
 */
import { db } from "./firebase";
import {
  collection, doc, getDoc, getDocs, onSnapshot, updateDoc,
  type DocumentData,
} from "firebase/firestore";
import {
  customerStatusOf, normalizeClients,
  type ClientLink, type CustomerAccount,
} from "./customer-link";

const COL = "customers";

function shape(uid: string, d: DocumentData): CustomerAccount {
  return {
    uid,
    email: (d.email as string) ?? "",
    displayName: (d.displayName as string) ?? "",
    kind: "customer",
    status: customerStatusOf(d.status),
    clients: normalizeClients(d.clients),
    requestedClient: (d.requestedClient as string) ?? "",
    createdAt: (d.createdAt as number) ?? undefined,
    approvedBy: (d.approvedBy as string) ?? undefined,
    approvedAt: (d.approvedAt as number) ?? undefined,
  };
}

/** Every customer account, oldest first — the approvals screen's list. */
export async function listCustomers(): Promise<CustomerAccount[]> {
  const snap = await getDocs(collection(db, COL));
  return snap.docs
    .map((d) => shape(d.id, d.data()))
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

/**
 * Does this uid hold a customer account? `null` = it could not be read.
 *
 * One read of the caller's OWN document (the rules allow it), asked once at
 * the portal's door so that an existing customer signing in is never sent to
 * the register route — which is idempotent but sits behind a per-IP limiter,
 * and five sign-ins from one office would otherwise spend it.
 */
export async function hasCustomerAccount(uid: string): Promise<boolean | null> {
  try {
    return (await getDoc(doc(db, COL, uid))).exists();
  } catch {
    return null;
  }
}

/** Live subscription to one account — null while it does not exist. */
export function watchCustomer(uid: string, cb: (c: CustomerAccount | null) => void) {
  return onSnapshot(
    doc(db, COL, uid),
    (snap) => cb(snap.exists() ? shape(uid, snap.data()) : null),
    // A rules denial or a dropped socket must not leave the portal spinning
    // forever; "no account" is the safe reading and shows the waiting card.
    () => cb(null),
  );
}

/**
 * Link an account to one or more «العملاء» rows and let it in.
 *
 * `clients` is written whole, never merged: the owner is looking at the full
 * list on screen when they save, and a merge would make removing a link
 * impossible from the only screen that offers it.
 */
export async function approveCustomer(uid: string, clients: ClientLink[], by: string) {
  await updateDoc(doc(db, COL, uid), {
    clients,
    status: "approved",
    approvedBy: by,
    approvedAt: Date.now(),
  });
}

/** Refuse an account outright. Keeps no link. */
export async function rejectCustomer(uid: string) {
  await updateDoc(doc(db, COL, uid), { status: "rejected", clients: [] });
}

/**
 * Take access away: back to pending AND the link cleared.
 *
 * Clearing `clients` is not housekeeping. `requireCustomer` admits an account
 * that is approved AND linked, so an empty list is a second, independent lock —
 * the same reasoning that made `rejectUser` clear the staff `role` (lib/users.ts).
 * A single later write that set `status: 'approved'` by itself would restore
 * nothing, because there would be no company to read.
 */
export async function revokeCustomer(uid: string) {
  await updateDoc(doc(db, COL, uid), { status: "pending", clients: [] });
}

/**
 * Edit the link of an already-approved account.
 *
 * ⚠ **The list is a list, but only its FIRST element is reachable today.**
 * `clients` is a list by design (owner decision 10), and everything that reads
 * it — `clientKeysOf`, `requireCustomer`, both portal filters — handles N
 * entries. The one screen that writes it, «حسابات العملاء»
 * (components/dashboard/customer-accounts.tsx), builds a single `ClientLink`
 * from one picked «العملاء» row and reads back `clients[0]`, so a buyer who
 * genuinely owns two separate rows in «العملاء» can only be given one of them
 * plus aliases on it — which merges two real companies under one name in the
 * owner's head. Noted rather than hidden (2026-09-23 review): the second
 * element is RESERVED, and adding a company to the picker is the change that
 * makes it reachable. Do not "simplify" the type to a single object — the read
 * side is already correct and the workbook has clients that are two rows.
 */
export async function setCustomerClients(uid: string, clients: ClientLink[]) {
  await updateDoc(doc(db, COL, uid), { clients });
}
