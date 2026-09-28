import type { Lang } from "./i18n";

/**
 * /connect/claude — the owner's «allow Claude» page for the Claude connector
 * (2026-09-28). Use as: cn[lang].xxx. en and ar keep the same shape
 * (tests/i18n-shape.test.ts).
 */
export const cn = {
  en: {
    title: "Connect Claude",
    intro: "Claude is asking to read ITQAN's factory data: production, downtime, OEE, work orders, stock and the warehouse.",
    readOnly: "Read-only — Claude cannot change anything in the sheets from this connection.",
    who: "Requested by {name}, returning to {host}.",
    signIn: "Sign in with Google",
    signedInAs: "Signed in as {email}",
    allow: "Allow",
    deny: "Don't allow",
    switchAccount: "Use another account",
    checking: "Checking the request…",
    redirecting: "Returning to Claude…",
    ownerOnly: "Only the owner's account can connect Claude. Sign in with the owner account.",
    badRequest: "This link is not a valid Claude connection request. Start again from Claude's connector settings.",
    notConfigured: "The connector is not configured on this server.",
    failed: "Something went wrong. Try again.",
    revoke: "To disconnect later, remove the connector in Claude's settings.",
  },
  ar: {
    title: "ربط Claude",
    intro: "Claude بيطلب قراءة بيانات مصنع اتقان: الإنتاج والتوقفات والكفاءة وأوامر الشغل والمتاح والمخزن.",
    readOnly: "قراءة فقط — Claude مش هيقدر يغيّر أي حاجة في الشيت من خلال الربط ده.",
    who: "الطلب من {name}، وهيرجع على {host}.",
    signIn: "تسجيل الدخول بجوجل",
    signedInAs: "مسجّل باسم {email}",
    allow: "سماح",
    deny: "رفض",
    switchAccount: "استخدام حساب تاني",
    checking: "جاري التحقق من الطلب…",
    redirecting: "جاري الرجوع إلى Claude…",
    ownerOnly: "حساب المالك بس هو اللي يقدر يربط Claude. سجّل الدخول بحساب المالك.",
    badRequest: "الرابط ده مش طلب ربط صحيح. ابدأ من جديد من إعدادات الـ Connectors في Claude.",
    notConfigured: "الربط مش متفعّل على السيرفر ده.",
    failed: "حصلت مشكلة. جرّب تاني.",
    revoke: "علشان تلغي الربط بعدين، احذف الـ Connector من إعدادات Claude.",
  },
} satisfies Record<Lang, Record<string, string>>;
