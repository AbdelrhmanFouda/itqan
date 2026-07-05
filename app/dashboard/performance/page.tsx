"use client";
import { useLang } from "@/context/LangContext";
import { pd } from "@/lib/i18n.prod";
import { DOWNTIME_REASONS, localize } from "@/lib/prod-meta";
import { Stat, Spinner, EmptyState } from "@/components/dashboard/ui";
import { DonutGauge, TrendChart, Pareto, LossBars, ChartCard, fmtPct, fmtNum } from "@/components/dashboard/charts";
import { formatDate } from "@/lib/dates";
import { useCallback, useEffect, useState } from "react";

type OEE = {
  availability: number; performance: number; quality: number; oee: number;
  performanceKnown: boolean; standardCoverage: number;
  plannedMin: number; runtimeMin: number; downtimeMin: number;
  goodUnits: number; scrapUnits: number; totalUnits: number;
  lossDowntimeMin: number; lossPerformanceMin: number; lossQualityMin: number;
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
type TrendPoint = {
  date: string; availability: number; performance: number | null; quality: number;
  oee: number | null; good: number; scrap: number; scrapRate: number; downtimeMin: number;
};
type Readiness = {
  runs: number; stubs: number; withMold: number; withScrap: number; withDowntime: number;
  plannedSource: { column: number; machines: number; default: number };
  machinesTabFound: boolean; defaultShiftMin: number;
  standardsInMaster: number; moldsSeen: number; moldsSeenWithStd: number;
};
type Data = {
  overall: OEE | null;
  bottlenecks: Bottleneck[];
  machines: MachineRow[];
  downtime: { reason: string; minutes: number }[];
  trend: TrendPoint[];
  months: string[];
  readiness: Readiness | null;
  standardsGap: { mold: string; units: number }[];
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
    factor: { availability: "Availability", performance: "Performance", quality: "Quality" },
    bottleneck: "Bottleneck Board", fixFirst: "fix this first",
    lostCap: "lost", recover: "recover", ofOutput: "of this machine's output",
    factorName: { downtime: "Downtime", performance: "Slow cycle", quality: "Scrap" },
    act: {
      downtime: (m: string, r: string) => `Cut downtime on ${m} — biggest cause: ${r}.`,
      performance: (m: string) => `${m} is running slower than its standard — check tooling, material and operator.`,
      quality: (m: string) => `High scrap on ${m} — review the mold's known defects.`,
    },
    trend: "Daily trend", trendHint: "availability · quality · OEE",
    lossTitle: "Where capacity is lost", lossHint: "minutes per machine",
    lossNames: { down: "Downtime", perf: "Slow cycle", qual: "Scrap" },
    assumed: "assumed — scrap not logged yet",
    noDowntimeLogged: "no downtime logged yet",
    needsMold: "needs product names on runs",
    needsStd: "needs cycle+cavities in Master",
    readiness: "Data readiness — what to log to make OEE true",
    readinessIntro: "Each OEE factor only counts what is actually logged. Missing pieces:",
    rMold: (n: number, t: number) => `${n}/${t} runs name their product or mold — required for Performance and full OEE`,
    rScrap: (n: number, t: number) => `${n}/${t} runs log scrap units — Quality is assumed 100% where missing`,
    rDown: (n: number, t: number) => `${n}/${t} runs log downtime — Availability assumes no stops where missing`,
    rMachines: (d: number) => `Machines tab not found — planned time uses the default ${d} min shift`,
    rMachinesPartial: (n: number, d: number) => `${n} runs fell back to the default ${d} min shift — add those machines to the Machines tab`,
    rStd: (k: number, s: number) => `${k}/${s} logged molds have a cycle standard in Master`,
    rStubs: (n: number) => `${n} empty rows in the Production tab were ignored`,
    fillMaster: "Fill cycle + cavities in Master for:", units: "pcs",
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
    factor: { availability: "الإتاحة", performance: "الأداء", quality: "الجودة" },
    bottleneck: "لوحة الاختناقات", fixFirst: "ابدأ بإصلاح هذا",
    lostCap: "مفقودة", recover: "استرجاع", ofOutput: "من إنتاج هذه الماكينة",
    factorName: { downtime: "توقف", performance: "بطء الدورة", quality: "هالك" },
    act: {
      downtime: (m: string, r: string) => `قلّل توقف ${m} — أكبر سبب: ${r}.`,
      performance: (m: string) => `${m} تعمل أبطأ من المعدل القياسي — افحص الاسطمبة والخامة والعامل.`,
      quality: (m: string) => `هالك مرتفع على ${m} — راجع عيوب الاسطمبة المعروفة.`,
    },
    trend: "الاتجاه اليومي", trendHint: "الإتاحة · الجودة · OEE",
    lossTitle: "أين تُفقد الطاقة الإنتاجية", lossHint: "دقائق لكل ماكينة",
    lossNames: { down: "توقف", perf: "بطء الدورة", qual: "هالك" },
    assumed: "افتراضي — الهالك غير مسجَّل بعد",
    noDowntimeLogged: "لا يوجد توقف مسجَّل بعد",
    needsMold: "يحتاج اسم المنتج في التشغيلات",
    needsStd: "يحتاج زمن الدورة والكافيتي في Master",
    readiness: "جاهزية البيانات — ما يجب تسجيله ليكون OEE حقيقيًا",
    readinessIntro: "كل عامل في OEE يُحسب فقط مما يُسجَّل فعلاً. الناقص:",
    rMold: (n: number, t: number) => `${n}/${t} تشغيلات بها اسم المنتج أو كود الاسطمبة — مطلوب لحساب الأداء وOEE الكامل`,
    rScrap: (n: number, t: number) => `${n}/${t} تشغيلات مسجَّل بها الهالك — الجودة تُفترض 100% عند غيابه`,
    rDown: (n: number, t: number) => `${n}/${t} تشغيلات مسجَّل بها التوقف — الإتاحة تفترض عدم وجود توقف عند غيابه`,
    rMachines: (d: number) => `تبويب Machines غير موجود — الزمن المخطط يستخدم وردية افتراضية ${d} دقيقة`,
    rMachinesPartial: (n: number, d: number) => `${n} تشغيلات استخدمت الوردية الافتراضية ${d} دقيقة — أضف هذه الماكينات إلى تبويب Machines`,
    rStd: (k: number, s: number) => `${k}/${s} من الاسطمبات المسجَّلة لها معيار دورة في Master`,
    rStubs: (n: number) => `تم تجاهل ${n} صفوف فارغة في تبويب Production`,
    fillMaster: "أكمل زمن الدورة + الكافيتي في Master لـ:", units: "قطعة",
  },
};

const pf = (x: number) => `${(x * 100).toFixed(1)}%`;
const oeeText = (x: number) => (x >= 0.85 ? "text-green-600" : x >= 0.6 ? "text-amber-600" : "text-red-600");

function Bar({ value, max, tone }: { value: number; max: number; tone: string }) {
  const w = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-2 rounded-full bg-gray-100 overflow-hidden" dir="ltr">
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
  const r = data.readiness;

  // Readiness checklist — only imperfect items are listed.
  const readinessItems: { ok: boolean; text: string }[] = [];
  if (r && r.runs > 0) {
    if (r.withMold < r.runs) readinessItems.push({ ok: false, text: t.rMold(r.withMold, r.runs) });
    if (r.withScrap < r.runs) readinessItems.push({ ok: false, text: t.rScrap(r.withScrap, r.runs) });
    if (r.withDowntime < r.runs) readinessItems.push({ ok: false, text: t.rDown(r.withDowntime, r.runs) });
    if (!r.machinesTabFound) readinessItems.push({ ok: false, text: t.rMachines(r.defaultShiftMin) });
    else if (r.plannedSource.default > 0) readinessItems.push({ ok: false, text: t.rMachinesPartial(r.plannedSource.default, r.defaultShiftMin) });
    if (r.moldsSeen > 0 && r.moldsSeenWithStd < r.moldsSeen) readinessItems.push({ ok: false, text: t.rStd(r.moldsSeenWithStd, r.moldsSeen) });
    if (r.stubs > 0) readinessItems.push({ ok: true, text: t.rStubs(r.stubs) });
  }

  const trendLabels = data.trend.map((d) => formatDate(d.date, lang));
  const maxScrapRate = Math.max(0.05, ...data.trend.map((d) => d.scrapRate * 1.25));
  const lossRows = data.machines
    .map((m) => ({
      label: m.machine,
      down: m.lossDowntimeMin,
      perf: m.lossPerformanceMin,
      qual: m.lossQualityMin,
    }))
    .filter((x) => x.down + x.perf + x.qual > 0)
    .sort((a, b) => b.down + b.perf + b.qual - (a.down + a.perf + a.qual));

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
          {/* Headline: OEE gauge + A / P / Q */}
          <div className={`grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-4 mb-3 ${isAr ? "sm:grid-cols-[1fr_auto]" : ""}`}>
            <div className={`bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-center ${isAr ? "sm:order-2" : ""}`}>
              <DonutGauge
                value={o.oee}
                known={o.performanceKnown}
                label={t.oee}
                sublabel={o.weakest ? `${t.limiting}: ${t.factor[o.weakest]}` : undefined}
                isAr={isAr}
              />
            </div>
            <div className={`grid grid-cols-1 sm:grid-cols-3 gap-4 ${isAr ? "sm:order-1" : ""}`}>
              <Stat
                label={t.availability}
                value={pf(o.availability)}
                tone={o.weakest === "availability" ? "red" : undefined}
                sub={r && r.withDowntime === 0 ? t.noDowntimeLogged : undefined}
              />
              <Stat
                label={t.performance}
                value={o.performanceKnown ? pf(o.performance) : "—"}
                tone={o.weakest === "performance" ? "red" : undefined}
                sub={!o.performanceKnown ? (r && r.moldsSeen === 0 ? t.needsMold : t.needsStd) : undefined}
              />
              <Stat
                label={t.quality}
                value={pf(o.quality)}
                tone={o.weakest === "quality" ? "red" : undefined}
                sub={r && r.withScrap === 0 ? t.assumed : undefined}
              />
            </div>
          </div>
          {o.performanceKnown && o.standardCoverage < 1 && (
            <p className="text-xs text-gray-400 mb-3">{t.coverage}: {pf(o.standardCoverage)}</p>
          )}

          {/* Data readiness — the honesty panel */}
          {readinessItems.length > 0 && (
            <div className="mb-10 bg-amber-50 border border-amber-200 rounded-xl p-4">
              <h2 className={`text-sm font-semibold text-amber-800 mb-1 ${isAr ? "text-right" : ""}`}>{t.readiness}</h2>
              <p className={`text-xs text-amber-700 mb-2 ${isAr ? "text-right" : ""}`}>{t.readinessIntro}</p>
              <ul className="space-y-1.5">
                {readinessItems.map((it, i) => (
                  <li key={i} className={`flex items-start gap-2 text-xs ${isAr ? "flex-row-reverse text-right" : ""}`}>
                    <span className={`mt-0.5 shrink-0 ${it.ok ? "text-green-600" : "text-amber-600"}`}>{it.ok ? "✓" : "●"}</span>
                    <span className="text-gray-700">{it.text}</span>
                  </li>
                ))}
              </ul>
              {data.standardsGap.length > 0 && (
                <div className={`mt-3 ${isAr ? "text-right" : ""}`}>
                  <span className="text-xs font-medium text-amber-800">{t.fillMaster}</span>
                  <div className={`flex flex-wrap gap-1.5 mt-1.5 ${isAr ? "flex-row-reverse" : ""}`}>
                    {data.standardsGap.map((g) => (
                      <span key={g.mold} className="text-xs bg-white border border-amber-200 text-gray-700 rounded-full px-2.5 py-0.5">
                        {g.mold} · {fmtNum(g.units, isAr)} {t.units}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
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
                        <div className="text-sm font-semibold text-red-600 whitespace-nowrap">{fmtNum(b.factorMin, isAr)} {t.min} {t.lostCap}</div>
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

          {/* Daily trend — availability / quality / OEE */}
          {data.trend.length > 1 && (
            <ChartCard title={t.trend} hint={t.trendHint} isAr={isAr}>
              <TrendChart
                isAr={isAr}
                labels={trendLabels}
                series={[
                  { name: t.availability, color: "#6b7280", values: data.trend.map((d) => d.availability) },
                  { name: t.quality, color: "#16a34a", values: data.trend.map((d) => d.quality) },
                  { name: t.oee, color: "#2563eb", values: data.trend.map((d) => d.oee) },
                ]}
              />
            </ChartCard>
          )}

          {/* Where capacity is lost — stacked minutes per machine */}
          {lossRows.length > 0 && (
            <ChartCard title={t.lossTitle} hint={t.lossHint} isAr={isAr}>
              <LossBars rows={lossRows} isAr={isAr} unit={t.min} names={t.lossNames} />
            </ChartCard>
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
            <ChartCard title={t.downtime} isAr={isAr}>
              <Pareto
                isAr={isAr}
                unit={t.min}
                items={data.downtime.map((d) => ({ label: reasonLabel(d.reason), value: d.minutes }))}
              />
            </ChartCard>
          )}

          {/* Scrap-rate trend */}
          {data.trend.length > 1 && r && r.withScrap > 0 && (
            <ChartCard title={t.scrapTrend} isAr={isAr}>
              <TrendChart
                isAr={isAr}
                labels={trendLabels}
                yMax={maxScrapRate}
                yFmt={(v) => fmtPct(v, isAr, 1)}
                series={[{ name: t.scrapTrend, color: "#dc2626", values: data.trend.map((d) => d.scrapRate) }]}
              />
            </ChartCard>
          )}
        </>
      )}
    </div>
  );
}
