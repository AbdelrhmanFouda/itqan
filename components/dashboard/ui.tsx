"use client";
import { ReactNode } from "react";
import { X } from "lucide-react";
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
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-3xl font-bold ${tone ? toneClasses[tone].split(" ")[1] : "text-gray-900"}`}>
        {value}
      </p>
      {sub ? <p className="text-xs text-gray-400 mt-1">{sub}</p> : null}
    </div>
  );
}

export function Pill({ text, tone }: { text: string; tone: Tone }) {
  return (
    <span className={`inline-block text-xs px-2.5 py-1 rounded-full border whitespace-nowrap ${toneClasses[tone]}`}>
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

export const inputCls =
  "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400";

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
    "inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const styles =
    variant === "primary"
      ? "bg-blue-600 hover:bg-blue-500 text-white"
      : variant === "danger"
      ? "text-red-600 hover:bg-red-50"
      : variant === "ghost"
      ? "text-gray-600 hover:bg-gray-100"
      : "border border-gray-300 text-gray-700 hover:bg-gray-50";
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
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-20 overflow-auto"
      onClick={onClose}
    >
      <div
        dir={isAr ? "rtl" : "ltr"}
        className="bg-white rounded-2xl w-full max-w-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="bg-white border border-dashed border-gray-300 rounded-xl p-10 text-center text-sm text-gray-500">
      {text}
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
