"use client";
import { ReactNode } from "react";
import { X, Inbox } from "lucide-react";
import { Tone, toneClasses } from "@/lib/prod-meta";

export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5">
      <p className="text-xs text-gray-500 mb-1.5">{label}</p>
      <p
        className={`text-2xl sm:text-3xl font-bold tracking-tight tabular-nums break-words ${
          tone ? toneClasses[tone].split(" ")[1] : "text-gray-900"
        }`}
      >
        {value}
      </p>
      {sub ? <p className="text-xs text-gray-400 mt-1">{sub}</p> : null}
    </div>
  );
}

export function Pill({ text, tone }: { text: string; tone: Tone }) {
  return (
    <span className={`inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full border whitespace-nowrap ${toneClasses[tone]}`}>
      {text}
    </span>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block mb-3">
      <span className="block text-xs font-medium text-gray-600 mb-1">{label}</span>
      {children}
    </label>
  );
}

// text-base below sm keeps iOS Safari from auto-zooming into focused fields;
// from sm up it is the same text-sm as before. min-h-11 keeps the field
// thumb-sized on phones (44px), back to compact from `sm:` up.
export const inputCls =
  "w-full border border-gray-300 rounded-lg px-3 py-2 min-h-11 sm:min-h-0 text-base sm:text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 disabled:bg-gray-50 disabled:text-gray-400";

export function Btn({
  children,
  onClick,
  type = "button",
  variant = "primary",
  disabled,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "outline" | "ghost" | "danger";
  disabled?: boolean;
  className?: string;
}) {
  const base =
    // min-h-11 (44px) on phones, back to the compact 36px from `sm:` up.
    // Measured in the owner's own Chrome at 372px on 2026-08-12: the layout
    // holds up fine at phone width, but almost every control was 26–36px tall.
    // 44px is the size a thumb hits reliably — and this is a factory floor,
    // where the thumb may be gloved or dirty.
    "inline-flex items-center justify-center gap-1.5 px-4 py-2 min-h-11 sm:min-h-0 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1";
  const styles =
    variant === "primary"
      ? "bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white shadow-sm"
      : variant === "danger"
      ? "text-red-600 hover:bg-red-50 active:bg-red-100 focus-visible:ring-red-500/40"
      : variant === "ghost"
      ? "text-gray-600 hover:bg-gray-100 active:bg-gray-200"
      : "border border-gray-300 text-gray-700 hover:bg-gray-50 active:bg-gray-100";
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${styles} ${className}`}>
      {children}
    </button>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  isAr,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  isAr?: boolean;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-start justify-center bg-black/40 sm:p-4 sm:pt-20 overflow-auto"
      onClick={onClose}
    >
      <div
        dir={isAr ? "rtl" : "ltr"}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-lg shadow-2xl max-h-[90dvh] sm:max-h-none flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100 shrink-0">
          <h3 className="font-semibold text-gray-900 min-w-0 truncate">{title}</h3>
          <button
            onClick={onClose}
            aria-label={isAr ? "إغلاق" : "Close"}
            className="shrink-0 -me-2.5 min-w-11 min-h-11 inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5 overflow-y-auto pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-5">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({ text, sub }: { text: string; sub?: string }) {
  return (
    <div className="bg-white border border-dashed border-gray-200 bg-gray-50/50 rounded-xl p-10 text-center space-y-1">
      <Inbox size={20} className="mx-auto text-gray-300" />
      <p className="text-sm font-medium text-gray-600">{text}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

export function Spinner({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-gray-400 py-8">
      <span className="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
      {text}
    </div>
  );
}
