"use client";
import { useLang } from "@/context/LangContext";
import { pd } from "@/lib/i18n.prod";
import { DOWNTIME_REASONS, localize } from "@/lib/prod-meta";
import { Stat, Spinner, EmptyState } from "@/components/dashboard/ui";
import { useCallback, useEffect, useState } from "react";

type OEE = {
  availability: number; performance: number; quality: number; oee: number;
  performanceKnown: boolean; standardCoverage: number;
  plannedMin: number; runtimeMin: number; downtimeMin: number;
  goodUnits: number; scrapUnits: number; totalUnits: number;
  weakest: "availability" | "performance" | "quality" | null;
};
type MachineRow = OEE & { machine: string };
type Bottleneck = {
  machine: string;
  factor: "downtime" | "performance" | "quality";
  factorMin: number;
  lostMin: number;
  oee: number;
  performanceKnown: boolean;
  recoverablePct: number | null;
  topDowntimeReason: string | null;
};
type Data = {
  overall: OEE | null;
  bottlenecks: Bottleneck[];
  machines: MachineRow[];
  downtime: { reason: string; minutes: number }[];
  daily: { date: string; good: number; scrap: number; scrapRate: number }[];
  months: string[];
  runCount: number;
  configured: boolean;
};

const L = {
  en: {
    title: "Performance — OEE", subtitle: "Overall Equipment Effectiveness, by machine",
    thisMonth: "This month", allTime: "All time",
    oee: "OEE", availability: "Availability", performance: "Performance", quality: "Quality",
    byMachine: "OEE by machine", worstFirst: "constraint first",
    limiting: "Limiting factor", coverage: "standard coverage", noStd: "no cycle standard",
    downtime: "Downtime by reason", scrapTrend: "Scrap-rate trend", min: "min",
    empty: "No production runs in this period yet. Log runs to see OEE.",
    tryAll: "There may be data in other months — view All time.",
    unreachable: "Couldn't reach the data sheet. Check the connection and reload.",
    noPerf: "Performance and OEE need each mold's cycle time + cavities in Master. Fill those for active molds.",
    factor: { availability: "Availability", performance: "Performance", quality: "Quality" },
    bottleneck: "Bottleneck Board", fixFirst: "fix this first",
    lostCap: "lost", recover: "recover", ofOutput: "of this machine's output",
    factorName: { downtime: "Downtime", performance: "Slow cycle", quality: "Scrap" },
    act: {
      downtime: (m: string, r: string) => `Cut downtime on ${m} — biggest cause: ${r}.`,
      performance: (m: string) => `${m} is running slower than its standard — check tooling, material and operator.`,
      quality: (m: string) => `High scrap on ${m} — review the mold's known defects.`,
    },
  },
  ar: {
    title: "الأداء — OEE", subtitle: "الفعالية الكلية للمعدات، لكل ماكينة",
    thisMonth: "هذا الشهر", allTime: "كل الوقت",
    oee: "OEE", availability: "الإتاحة", performance: "الأداء", quality: "الجودة",
    byMachine: "OEE لكل ماكينة", worstFirst: "الأضعف أولاً",
    limiting: "العامل المُقيِّد", coverage: "تغطية المعايير", noStd: "لا يوجد معيار دورة",
    downtime: "التوقف حسب السبب", scrapTrend: "اتجاه نسبة الهالك", min: "د",
    empty: "لا توجد تشغيلات إنتاج في هذه الفترة بعد. سجّل التشغيلات لرؤية OEE.",
    tryAll: "قد توجد بيانات في أشهر أخرى — اعرض كل الوقت.",
    unreachable: "تعذّر الوصول إلى جدول البيانات. تحقق من الاتصال وأعد التحميل.",
    noPerf: "يحتاج الأداء وOEE إلى زمن الدورة وعدد الكافيتي لكل اسطمبة في Master. أكملها للاسطمبات النشطة.",
    factor: { availability: "الإتاحة", performance: "الأداء", quality: "الجودة" },
    bottleneck: "لوحة الاختناقات", fixFirst: "ابدأ بإصلاح هذا",
    lostCap: "مفقودة", recover: "استرجاع", ofOutput: "من إنتاج هذه الماكينة",
    factorName: { downtime: "توقف", performance: "بطء الدورة", quality: "هالك" },
    act: {
      downtime: (m: string, r: string) => `قلّل توقف ${m} — أكبر سبب: ${r}.`,
      performance: (m: string) => `${m} تعمل أبطأ من المعدل القياسي — افحص الاسطمبة والخامة والعامل.`,
      quality: (m: string) => `هالك مرتفع على ${m} — راجع عيوب الاسطمبة المعروفة.`,
    },
  },
};

const pf = (x: number) => `${(x * 100).toFixed(1)}%`;
const oeeText = (x: number) => (x >= 0.85 ? "text-green-600" : x >= 0.6 ? "text-amber-600" : "text-red-600");

function Bar({ value, max, tone }: { value: number; max: number; tone: string }) {
  const w = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${w}%` }} />
    </div>
  );
}

export default function PerformancePage() {
  const { lang } = useLang();
  const p = pd[lang];
  const t = L[lang];
  const isAr = lang === "ar";
  const thisMonth = new Date().toISOString().slice(0, 7);

  const [period, setPeriod] = useState<"month" | "all">("month");
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const q = period === "month" ? `?month=${thisMonth}` : "";
      const res = await fetch(`/api/oee${q}`);
      if (!res.ok) throw new Error("bad_status");
      setData(await res.json());
    } catch {
      setError(true); // keep any previously-loaded data on screen
    } finally {
      setLoading(false);
    }
  }, [period, thisMonth]);
  useEffect(() => { load(); }, [load]);

  const reasonLabel = (r: string) => localize(r, DOWNTIME_REASONS, p.runs.reasons);
  const pf0 = (x: number) => `${Math.round(x * 100)}%`;
  const fmtN = (x: number) => x.toLocaleString(isAr ? "ar-EG" : "en-US");
  const action = (b: Bottleneck) =>
    b.factor === "downtime"
      ? t.act.downtime(b.machine, b.topDowntimeReason ? reasonLabel(b.topDowntimeReason) : "—")
      : b.factor === "performance"
        ? t.act.performance(b.machine)
        : t.act.quality(b.machine);

  if (loading && !data) return <Spinner text={p.common.loading} />;
  if ((error && !data) || (data && !data.configured)) {
    return (
      <div className="max-w-5xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">{t.title}</h1>
        <p className="text-sm text-gray-500 mb-6">{t.subtitle}</p>
        <div className="bg-white border border-dashed border-red-300 rounded-xl p-10 text-center text-sm text-red-600">{t.unreachable}</div>
      </div>
    );
  }
  if (!data) return <Spinner text={p.common.loading} />;

  const o = data.overall;
  const maxDown = Math.max(1, ...data.downtime.map((d) => d.minutes));
  const maxRate = Math.max(0.0001, ...data.daily.map((d) => d.scrapRate));

  return (
    <div className="max-w-5xl">
      <div className={`flex items-center justify-between mb-1 ${isAr ? "flex-row-reverse" : ""}`}>
        <h1 className="text-2xl font-bold text-gray-900">{t.title}</h1>
        <div className={`inline-flex rounded-lg border border-gray-200 bg-white p-0.5 ${isAr ? "flex-row-reverse" : ""}`}>
          {(["month", "all"] as const).map((key) => (
            <button
              key={key}
              onClick={() => setPeriod(key)}
              className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                period === key ? "bg-blue-600 text-white" : "text-gray-500 hover:text-gray-900"
              }`}
            >
              {key === "month" ? t.thisMonth : t.allTime}
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-6">{t.subtitle}</p>

      {data.runCount === 0 || !o ? (
        <div>
          <EmptyState text={t.empty} />
          {period === "month" && data.months.length > 0 && (
            <p className="text-center mt-3">
              <button onClick={() => setPeriod("all")} className="text-xs text-blue-600 hover:underline">{t.tryAll}</button>
            </p>
          )}
        </div>
      ) : (
        <>
          {/* Headline OEE + A / P / Q */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-3">
            <Stat
              label={t.oee}
              value={<span className={oeeText(o.oee)}>{o.performanceKnown ? pf(o.oee) : "—"}</span>}
              sub={o.weakest ? `${t.limiting}: ${t.factor[o.weakest]}` : undefined}
            />
            <Stat label={t.availability} value={pf(o.availability)} tone={o.weakest === "availability" ? "red" : undefined} />
            <Stat
              label={t.performance}
              value={o.performanceKnown ? pf(o.performance) : "—"}
              tone={o.weakest === "performance" ? "red" : undefined}
            />
            <Stat label={t.quality} value={pf(o.quality)} tone={o.weakest === "quality" ? "red" : undefined} />
          </div>
          {!o.performanceKnown && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-8">{t.noPerf}</p>
          )}
          {o.performanceKnown && o.standardCoverage < 1 && (
            <p className="text-xs text-gray-400 mb-8">{t.coverage}: {pf(o.standardCoverage)}</p>
          )}

          {/* Bottleneck Board — fix this first */}
          {data.bottlenecks.length > 0 && (
            <div className="mb-10">
              <div className={`flex items-baseline gap-2 mb-3 ${isAr ? "flex-row-reverse" : ""}`}>
                <h2 className="text-sm font-semibold text-gray-900">{t.bottleneck}</h2>
                <span className="text-xs text-gray-400">· {t.fixFirst}</span>
              </div>
              <div className="space-y-3">
                {data.bottlenecks.map((b, i) => (
                  <div key={b.machine} className={`rounded-xl p-4 border ${i === 0 ? "border-red-300 bg-red-50/50" : "border-gray-200 bg-white"}`}>
                    <div className={`flex items-start justify-between gap-3 ${isAr ? "flex-row-reverse" : ""}`}>
                      <div className={`flex items-center gap-2.5 ${isAr ? "flex-row-reverse" : ""}`}>
                        <span className={`w-6 h-6 shrink-0 rounded-full text-xs font-bold flex items-center justify-center ${i === 0 ? "bg-red-600 text-white" : "bg-gray-200 text-gray-600"}`}>{i + 1}</span>
                        <span className="font-medium text-gray-900">{b.machine}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${i === 0 ? "border-red-200 bg-red-100 text-red-700" : "border-gray-200 bg-gray-50 text-gray-600"}`}>{t.factorName[b.factor]}</span>
                      </div>
                      <div className={`shrink-0 ${isAr ? "text-start" : "text-end"}`}>
                        <div className="text-sm font-semibold text-red-600 whitespace-nowrap">{fmtN(b.factorMin)} {t.min} {t.lostCap}</div>
                        {b.recoverablePct != null && (
                          <div className="text-xs text-gray-400 whitespace-nowrap">{t.recover} ≈ {pf0(b.recoverablePct)} {t.ofOutput}</div>
                        )}
                      </div>
                    </div>
                    <p className={`text-xs text-gray-600 mt-2 ${isAr ? "text-right" : ""}`}>{action(b)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* OEE by machine — constraint first */}
          <div className={`flex items-baseline gap-2 mb-3 ${isAr ? "flex-row-reverse" : ""}`}>
            <h2 className="text-sm font-semibold text-gray-900">{t.byMachine}</h2>
            <span className="text-xs text-gray-400">· {t.worstFirst}</span>
          </div>
          <div className="space-y-3 mb-10">
            {data.machines.map((m) => (
              <div key={m.machine} className="bg-white border border-gray-200 rounded-xl p-4">
                <div className={`flex items-center justify-between mb-3 ${isAr ? "flex-row-reverse" : ""}`}>
                  <span className="font-medium text-gray-900">{m.machine}</span>
                  <span className={`text-lg font-bold ${m.performanceKnown ? oeeText(m.oee) : "text-gray-300"}`}>
                    {m.performanceKnown ? pf(m.oee) : t.noStd}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  {([
                    ["availability", m.availability, true],
                    ["performance", m.performance, m.performanceKnown],
                    ["quality", m.quality, true],
                  ] as const).map(([k, val, known]) => (
                    <div key={k}>
                      <div className={`flex items-center justify-between text-xs mb-1 ${isAr ? "flex-row-reverse" : ""}`}>
                        <span className="text-gray-500">{t.factor[k]}</span>
                        <span className={`font-medium ${m.weakest === k ? "text-red-600" : "text-gray-700"}`}>
                          {known ? pf(val) : "—"}
                        </span>
                      </div>
                      <Bar value={known ? val : 0} max={1} tone={m.weakest === k ? "bg-red-500" : "bg-gray-300"} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Downtime Pareto */}
          {data.downtime.length > 0 && (
            <div className="mb-10">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">{t.downtime}</h2>
              <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
                {data.downtime.map((d) => (
                  <div key={d.reason}>
                    <div className={`flex items-center justify-between text-xs mb-1 ${isAr ? "flex-row-reverse" : ""}`}>
                      <span className="text-gray-600">{reasonLabel(d.reason)}</span>
                      <span className="text-gray-400">{d.minutes.toLocaleString(isAr ? "ar-EG" : "en-US")} {t.min}</span>
                    </div>
                    <Bar value={d.minutes} max={maxDown} tone="bg-blue-500" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Scrap-rate trend */}
          {data.daily.length > 0 && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">{t.scrapTrend}</h2>
              <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-2">
                {data.daily.map((d) => (
                  <div key={d.date} className={`flex items-center gap-3 ${isAr ? "flex-row-reverse" : ""}`}>
                    <span className="text-xs text-gray-400 w-24 shrink-0 whitespace-nowrap">{d.date}</span>
                    <div className="flex-1"><Bar value={d.scrapRate} max={maxRate} tone={d.scrapRate > 0.03 ? "bg-red-500" : "bg-gray-300"} /></div>
                    <span className={`text-xs w-12 text-end shrink-0 ${d.scrapRate > 0.03 ? "text-red-600" : "text-gray-500"}`}>{pf(d.scrapRate)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
