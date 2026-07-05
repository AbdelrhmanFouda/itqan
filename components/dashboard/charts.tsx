"use client";
/**
 * Dashboard charts — hand-built SVG, zero dependencies.
 * Bilingual/RTL-safe: time axes stay LTR (convention even in Arabic charts),
 * labels/numbers localize. Colors follow the dashboard palette.
 */

import { ReactNode } from "react";

export const oeeColor = (x: number) => (x >= 0.85 ? "#16a34a" : x >= 0.6 ? "#d97706" : "#dc2626");
const AXIS = "#9ca3af", GRID = "#f3f4f6";

const fmtLocale = (isAr: boolean) => (isAr ? "ar-EG" : "en-US");
export const fmtNum = (x: number, isAr: boolean) => x.toLocaleString(fmtLocale(isAr));
export const fmtPct = (x: number, isAr: boolean, digits = 0) =>
  `${(x * 100).toLocaleString(fmtLocale(isAr), { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;

/* ------------------------------- Donut gauge ------------------------------ */

export function DonutGauge({
  value, known, label, sublabel, size = 148, isAr,
}: {
  value: number; known: boolean; label: string; sublabel?: string; size?: number; isAr: boolean;
}) {
  const r = 56, c = 2 * Math.PI * r;
  const v = known ? Math.min(1, Math.max(0, value)) : 0;
  const color = known ? oeeColor(v) : "#d1d5db";
  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox="0 0 140 140" role="img" aria-label={label}>
        <circle cx="70" cy="70" r={r} fill="none" stroke={GRID} strokeWidth="14" />
        <circle
          cx="70" cy="70" r={r} fill="none" stroke={color} strokeWidth="14"
          strokeLinecap="round" strokeDasharray={`${c * v} ${c}`}
          transform="rotate(-90 70 70)"
        />
        <text x="70" y="66" textAnchor="middle" fontSize="24" fontWeight="700" fill={known ? color : AXIS}>
          {known ? fmtPct(v, isAr, 1) : "—"}
        </text>
        <text x="70" y="86" textAnchor="middle" fontSize="11" fill={AXIS}>{label}</text>
      </svg>
      {sublabel && <div className="text-xs text-gray-400 -mt-1 text-center px-2">{sublabel}</div>}
    </div>
  );
}

/* ------------------------------- Trend lines ------------------------------ */

export type TrendSeries = { name: string; color: string; values: (number | null)[]; dashed?: boolean };

export function TrendChart({
  series, labels, isAr, yMax = 1, yFmt, height = 190,
}: {
  series: TrendSeries[]; labels: string[]; isAr: boolean;
  yMax?: number; yFmt?: (v: number) => string; height?: number;
}) {
  const W = 620, H = height, PL = 44, PR = 10, PT = 12, PB = 26;
  const iw = W - PL - PR, ih = H - PT - PB;
  const n = labels.length;
  const x = (i: number) => PL + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => PT + ih - (Math.min(v, yMax) / yMax) * ih;
  const fy = yFmt ?? ((v: number) => fmtPct(v, isAr));

  // Split each series into contiguous segments (nulls break the line).
  const segs = (vals: (number | null)[]) => {
    const out: { i: number; v: number }[][] = [];
    let cur: { i: number; v: number }[] = [];
    vals.forEach((v, i) => {
      if (v === null || v === undefined) { if (cur.length) out.push(cur); cur = []; }
      else cur.push({ i, v });
    });
    if (cur.length) out.push(cur);
    return out;
  };

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * yMax);
  const every = Math.max(1, Math.ceil(n / 8));

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PL} x2={W - PR} y1={y(t)} y2={y(t)} stroke={GRID} />
            <text x={PL - 6} y={y(t) + 3.5} fontSize="10" fill={AXIS} textAnchor="end">{fy(t)}</text>
          </g>
        ))}
        {labels.map((l, i) =>
          i % every === 0 ? (
            <text key={i} x={x(i)} y={H - 8} fontSize="10" fill={AXIS} textAnchor="middle">{l}</text>
          ) : null,
        )}
        {series.map((s) =>
          segs(s.values).map((seg, k) => (
            <g key={s.name + k}>
              {seg.length > 1 && (
                <polyline
                  fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
                  strokeDasharray={s.dashed ? "4 4" : undefined}
                  points={seg.map((p) => `${x(p.i)},${y(p.v)}`).join(" ")}
                />
              )}
              {seg.map((p) => (
                <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r="3" fill={s.color}>
                  <title>{`${labels[p.i]} — ${s.name}: ${fy(p.v)}`}</title>
                </circle>
              ))}
            </g>
          )),
        )}
      </svg>
      <div className={`flex flex-wrap gap-x-4 gap-y-1 mt-1 ${isAr ? "flex-row-reverse" : ""}`}>
        {series.map((s) => (
          <span key={s.name} className={`inline-flex items-center gap-1.5 text-xs text-gray-500 ${isAr ? "flex-row-reverse" : ""}`}>
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------- Pareto (bars) ------------------------------ */

export function Pareto({
  items, unit, isAr,
}: {
  items: { label: string; value: number }[]; unit: string; isAr: boolean;
}) {
  const total = items.reduce((a, b) => a + b.value, 0) || 1;
  const max = Math.max(...items.map((i) => i.value), 1);
  let cum = 0;
  return (
    <div className="space-y-3">
      {items.map((it) => {
        cum += it.value;
        const share = cum / total;
        return (
          <div key={it.label}>
            <div className={`flex items-center justify-between text-xs mb-1 ${isAr ? "flex-row-reverse" : ""}`}>
              <span className="text-gray-600">{it.label}</span>
              <span className="text-gray-400 whitespace-nowrap">
                {fmtNum(it.value, isAr)} {unit} · Σ {fmtPct(share, isAr)}
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden" dir="ltr">
              <div className="h-full rounded-full bg-blue-500" style={{ width: `${(it.value / max) * 100}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------- Stacked loss bars/machine ---------------------- */

export type LossRow = { label: string; down: number; perf: number; qual: number };

export function LossBars({
  rows, isAr, names, unit,
}: {
  rows: LossRow[]; isAr: boolean; unit: string;
  names: { down: string; perf: string; qual: string };
}) {
  const COLORS = { down: "#3b82f6", perf: "#f59e0b", qual: "#ef4444" } as const;
  const max = Math.max(...rows.map((r) => r.down + r.perf + r.qual), 1);
  const seg = (v: number) => `${(v / max) * 100}%`;
  return (
    <div>
      <div className="space-y-3">
        {rows.map((r) => {
          const total = r.down + r.perf + r.qual;
          return (
            <div key={r.label}>
              <div className={`flex items-center justify-between text-xs mb-1 ${isAr ? "flex-row-reverse" : ""}`}>
                <span className="text-gray-700 font-medium">{r.label}</span>
                <span className="text-gray-400 whitespace-nowrap">{fmtNum(Math.round(total), isAr)} {unit}</span>
              </div>
              <div className="h-3 rounded-full bg-gray-100 overflow-hidden flex" dir="ltr">
                {r.down > 0 && <div style={{ width: seg(r.down), background: COLORS.down }} title={names.down} />}
                {r.perf > 0 && <div style={{ width: seg(r.perf), background: COLORS.perf }} />}
                {r.qual > 0 && <div style={{ width: seg(r.qual), background: COLORS.qual }} />}
              </div>
            </div>
          );
        })}
      </div>
      <div className={`flex flex-wrap gap-x-4 gap-y-1 mt-3 ${isAr ? "flex-row-reverse" : ""}`}>
        {(["down", "perf", "qual"] as const).map((k) => (
          <span key={k} className={`inline-flex items-center gap-1.5 text-xs text-gray-500 ${isAr ? "flex-row-reverse" : ""}`}>
            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: COLORS[k] }} />
            {names[k]}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ Section shell ----------------------------- */

export function ChartCard({ title, hint, isAr, children }: {
  title: string; hint?: string; isAr: boolean; children: ReactNode;
}) {
  return (
    <div className="mb-10">
      <div className={`flex items-baseline gap-2 mb-3 ${isAr ? "flex-row-reverse" : ""}`}>
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {hint && <span className="text-xs text-gray-400">· {hint}</span>}
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-5">{children}</div>
    </div>
  );
}
