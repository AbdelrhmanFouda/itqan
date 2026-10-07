"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { Globe } from "lucide-react";

/**
 * The card a signed-in account meets when it cannot see the thing behind it —
 * "awaiting approval", "access not granted", and (2026-09-23) the customer
 * portal's waiting and closed-account screens.
 *
 * Lifted out of app/dashboard/layout.tsx unchanged, because the portal needs
 * the same screen with different words and the dashboard must keep the look it
 * has. Only two things were added, both optional and both defaulting to the
 * dashboard's existing behaviour: `tone`, so a closed account can be red
 * rather than the amber "we are working on it" dot, and `extra`, so the portal
 * can put a WhatsApp button under the message — a buyer whose account was
 * stopped has nowhere else to go.
 */
export function StatusScreen(props: {
  isAr: boolean;
  title: string;
  body: string;
  email: string;
  requestedLabel?: string;
  signedInAs: string;
  signOutLabel: string;
  backLabel: string;
  onSignOut: () => void;
  langBtn: string;
  onLang: () => void;
  tone?: "amber" | "red";
  extra?: ReactNode;
}) {
  const red = props.tone === "red";
  return (
    <div dir={props.isAr ? "rtl" : "ltr"} className="min-h-screen bg-gray-50 flex flex-col">
      <header className="h-14 flex items-center px-6">
        <Link href="/" className="font-bold text-gray-900 text-sm">
          إتقان <span className="text-blue-600">Itqan</span>
        </Link>
        <button
          onClick={props.onLang}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 border border-gray-200 rounded px-2.5 py-1.5 min-h-11 sm:min-h-0 transition-colors ms-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1"
        >
          <Globe size={12} />
          {props.langBtn}
        </button>
      </header>
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-sm bg-white border border-gray-200 rounded-2xl shadow-sm p-7 text-center">
          <div
            className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 ${
              red ? "bg-red-50 border border-red-200" : "bg-amber-50 border border-amber-200"
            }`}
          >
            <span className={`w-2.5 h-2.5 rounded-full ${red ? "bg-red-400" : "bg-amber-400 animate-pulse"}`} />
          </div>
          <h1 className="text-lg font-bold text-gray-900 mb-2">{props.title}</h1>
          <p className="text-sm text-gray-500 leading-relaxed mb-4">{props.body}</p>
          {props.requestedLabel && (
            <p className="inline-block text-xs px-2.5 py-1 rounded-full border border-blue-200 bg-blue-50 text-blue-700 mb-4">
              {props.requestedLabel}
            </p>
          )}
          {props.extra}
          <p className="text-xs text-gray-400 mb-5">{props.signedInAs}: <bdi dir="ltr">{props.email}</bdi></p>
          <button
            onClick={props.onSignOut}
            className="w-full border border-gray-300 hover:bg-gray-50 active:bg-gray-100 text-gray-700 text-sm px-4 py-2 min-h-11 sm:min-h-0 inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1"
          >
            {props.signOutLabel}
          </button>
          <Link href="/" className="block text-xs text-gray-400 hover:text-gray-600 mt-3 py-2.5">{props.backLabel}</Link>
        </div>
      </div>
    </div>
  );
}

export default StatusScreen;
