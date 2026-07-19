import { NextRequest, NextResponse } from "next/server";
import {
  verifyIdToken, roleFor, peekUsage, consumeUsage,
  type VerifiedUser, type UsageState,
} from "@/lib/agent-auth";
import {
  newToolCtx, readRecords, getOee,
  validateProductionRows, validateIssue, validateUpdate,
  appendProductionRows, logIssue, updateCell,
  type ProposedRow, type ProposedIssue, type ProposedUpdate,
  type ValidatedRow, type ValidatedIssue,
} from "@/lib/agent-tools";
import { type Role } from "@/lib/roles";

/**
 * In-app AI agent — reads the sheet, VALIDATES, and PROPOSES writes; a human
 * confirms in the UI before anything is written. No silent writes, ever.
 *
 * POST /api/agent
 *   { idToken, lang?, messages:[{role,content}] }   → chat turn (tool-use loop)
 *   { idToken, confirm:{ kind, ... } }              → execute a confirmed write
 *
 * Auth: Firebase ID token verified server-side (lib/agent-auth, no firebase-admin).
 * Limit: per-user daily message cap (owner/manager unlimited).
 */

export const runtime = "nodejs"; // node:crypto for JWT verification
export const dynamic = "force-dynamic";

const MODEL = process.env.AI_AGENT_MODEL?.trim() || "claude-haiku-4-5";
const MAX_ITERS = 8; // tool-loop cap — cost guardrail
const API_KEY = process.env.ANTHROPIC_API_KEY?.trim();

// Roles allowed to use the assistant (OPS + full access, per the milestone spec).
const ALLOWED: Role[] = ["owner", "manager", "production", "quality"];

/* --------------------------------- tools ---------------------------------- */

const TOOLS = [
  {
    name: "read_records",
    description:
      "Read rows from a sheet tab. entity ∈ production|master|machines|molds|products|clients|jobs|issues|hourly. " +
      "hourly = «تسجيل الإنتاج»: one row per machine per day, hour columns are PIECES; " +
      "systemTotal−actualTotal ≈ scrap when the crew filled the hand-counted الفعلي. " +
      "Optional case/space-insensitive `search` filters rows; `limit` (default 30, max 60). " +
      "Each record includes its sheet `row` number (needed for propose_cell_update).",
    input_schema: {
      type: "object",
      properties: {
        entity: { type: "string", enum: ["production", "master", "machines", "molds", "products", "clients", "jobs", "issues", "hourly"] },
        search: { type: "string" },
        limit: { type: "number" },
      },
      required: ["entity"],
    },
  },
  {
    name: "get_oee",
    description:
      "Get the compact OEE digest (availability × performance × quality, per-machine ranking, suspect standards, " +
      "downtime pareto, 14-day trend, data-readiness). Optional `month` as YYYY-MM; omit for all history.",
    input_schema: {
      type: "object",
      properties: { month: { type: "string", description: "YYYY-MM" } },
    },
  },
  {
    name: "propose_production_rows",
    description:
      "Validate one or more production rows and show them to the user for CONFIRMATION. This does NOT write. " +
      "Always read master + machines first to get exact product names and machine labels. " +
      "Report every error/warning the tool returns, then STOP and wait for the human to confirm.",
    input_schema: {
      type: "object",
      properties: {
        rows: {
          type: "array",
          items: {
            type: "object",
            properties: {
              date: { type: "string", description: "any format; will be normalized" },
              shift: { type: "string" },
              machine: { type: "string", description: "machine code label, e.g. 'PQ 4 — 220'" },
              machineCode: { type: "string" },
              mold: { type: "string" },
              product: { type: "string", description: "must match a Master product name exactly" },
              plannedMin: { type: "number" },
              good: { type: "number", description: "good pieces" },
              scrap: { type: "number" },
              shots: { type: "number", description: "machine shot count (if the crew logged shots not pieces)" },
              openCavities: { type: "number", description: "cavities open this run" },
              downtimeMin: { type: "number" },
              downtimeReason: { type: "string" },
              operator: { type: "string" },
              note: { type: "string" },
            },
            required: ["product"],
          },
        },
      },
      required: ["rows"],
    },
  },
  {
    name: "propose_issue",
    description:
      "Validate a fault/issue and show it for confirmation (appends to the الأعطال log on confirm). Does NOT write.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string" },
        machine: { type: "string", description: "Registry label «PQ n — ton». Resolve via the product name when the reported code conflicts." },
        product: { type: "string", description: "Product name exactly as in Master — floor reports identify machines by product more reliably than by code." },
        category: { type: "string", enum: ["خامة", "اسطمبة", "ماكينة", "كهرباء", "أخرى"] },
        description: { type: "string" },
        action: { type: "string" },
        status: { type: "string", enum: ["مفتوح", "قيد التنفيذ", "تم"] },
        note: { type: "string" },
      },
      required: ["description"],
    },
  },
  {
    name: "propose_cell_update",
    description:
      "Propose editing ONE cell to correct data (e.g. a wrong Master cycle time). Does NOT write; shown for confirmation. " +
      "Get the target `row` from read_records first. entity ∈ master|clients|production|jobs|machines.",
    input_schema: {
      type: "object",
      properties: {
        entity: { type: "string", enum: ["master", "clients", "production", "jobs", "machines"] },
        row: { type: "number" },
        field: { type: "string" },
        value: { type: "string" },
      },
      required: ["entity", "row", "field", "value"],
    },
  },
];

type Preview =
  | { kind: "production"; rows: ValidatedRow[]; blocked: boolean }
  | { kind: "issue"; issue: ValidatedIssue; blocked: boolean }
  | { kind: "update"; update: ProposedUpdate };

/* -------------------------------- prompt ---------------------------------- */

function systemPrompt(lang: string): string {
  return [
    "You are the production assistant for ITQAN, an Egyptian plastic-injection molding factory.",
    "The factory's database is a Google Sheet. Staff paste crew reports (often WhatsApp text) or ask questions.",
    "",
    "Your job: read the sheet, VALIDATE carefully, and PROPOSE writes. You NEVER write directly — a human confirms every write in the UI.",
    "",
    "Rules:",
    "- Before proposing a production row, use read_records on `master` (products/standards) and `machines` (registry) to get EXACT product names and machine labels. Joins are by product NAME — an inexact name breaks OEE.",
    "- The machine's identity is its code label like 'PQ 4 — 220'. Resolve machines by product name when a code is unreliable.",
    "- Hourly numbers are machine SHOTS, not pieces. Final good is counted pieces. scrap = shots × openCavities − good, and can never be negative.",
    "- «غير متاح / N/A» means unknown — treat as blank, never invent numbers.",
    "- After you call a propose_* tool, relay its errors/warnings plainly, then STOP and tell the user to press Confirm. Do not re-propose or try to write.",
    "- For questions (OEE, downtime, a product, a client), answer from tools with real numbers only. Be concise and practical, like a plant manager.",
    `- ALWAYS reply in ${lang === "ar" ? "Arabic (Egyptian-friendly Modern Standard Arabic)" : "English"}. Keep it short.`,
  ].join("\n");
}

/* ----------------------------- Anthropic call ----------------------------- */

type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };
type Msg = { role: "user" | "assistant"; content: string | Block[] };

async function callAnthropic(system: string, messages: Msg[]) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 1500, temperature: 0.2, system, tools: TOOLS, messages }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`anthropic_${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as { content: Block[]; stop_reason: string };
}

/* --------------------------------- POST ----------------------------------- */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // --- auth (both branches need it) ---
    const token = String(body.idToken || "");
    let user: VerifiedUser;
    try {
      user = await verifyIdToken(token);
    } catch {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const role = await roleFor(user);
    if (!role || !ALLOWED.includes(role))
      return NextResponse.json({ error: "forbidden" }, { status: 403 });

    // --- confirm branch: execute a previously-previewed write ---
    if (body.confirm) return handleConfirm(body.confirm);

    // --- chat branch ---
    if (!API_KEY) return NextResponse.json({ error: "no_api_key" }, { status: 503 });

    const lang = body.lang === "ar" ? "ar" : "en";
    const history: Msg[] = Array.isArray(body.messages)
      ? body.messages
          .filter((m: { role?: string; content?: unknown }) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
          .slice(-16)
          .map((m: { role: "user" | "assistant"; content: string }) => ({ role: m.role, content: m.content }))
      : [];
    if (history.length === 0 || history[history.length - 1].role !== "user")
      return NextResponse.json({ error: "no_message" }, { status: 400 });

    // Enforce the daily limit BEFORE spending tokens.
    const usage = await consumeUsage(user.uid, role);
    if (!usage.allowed)
      return NextResponse.json(
        {
          error: "limit_reached",
          limitMessage: {
            en: `You've reached today's limit of ${usage.limit} messages. It resets tomorrow.`,
            ar: `لقد وصلت إلى الحد اليومي (${usage.limit} رسالة). ستتجدد غدًا.`,
          },
          remaining: 0,
          limit: usage.limit,
        },
        { status: 429 },
      );

    // Tool-use loop.
    const ctx = newToolCtx();
    const messages: Msg[] = [...history];
    let preview: Preview | null = null;
    let reply = "";

    for (let i = 0; i < MAX_ITERS; i++) {
      const resp = await callAnthropic(systemPrompt(lang), messages);
      const textOut = resp.content.filter((b): b is Extract<Block, { type: "text" }> => b.type === "text").map((b) => b.text).join("\n").trim();
      if (textOut) reply = textOut;

      const toolUses = resp.content.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
      if (resp.stop_reason !== "tool_use" || toolUses.length === 0) break;

      messages.push({ role: "assistant", content: resp.content });
      const results: Block[] = [];
      for (const tu of toolUses) {
        const { output, capturedPreview } = await runTool(tu.name, tu.input, ctx);
        if (capturedPreview) preview = capturedPreview;
        results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(output).slice(0, 12000) });
      }
      messages.push({ role: "user", content: results });
      if (i === MAX_ITERS - 1) {
        // Out of iterations — get one final natural-language turn without tools.
        const final = await callAnthropic(systemPrompt(lang), messages);
        reply = final.content.filter((b): b is Extract<Block, { type: "text" }> => b.type === "text").map((b) => b.text).join("\n").trim() || reply;
      }
    }

    return NextResponse.json({
      reply: reply || (lang === "ar" ? "تم." : "Done."),
      preview,
      remaining: usage.remaining,
      limit: usage.limit,
      model: MODEL,
    });
  } catch (err) {
    console.error("agent route error:", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

/* ------------------------------ tool runner ------------------------------- */

async function runTool(
  name: string, input: Record<string, unknown>, ctx: ReturnType<typeof newToolCtx>,
): Promise<{ output: unknown; capturedPreview?: Preview }> {
  switch (name) {
    case "read_records":
      return { output: await readRecords(String(input.entity || ""), input.search as string | undefined, input.limit as number | undefined, ctx) };
    case "get_oee":
      return { output: await getOee(input.month as string | undefined) };
    case "propose_production_rows": {
      const rows = (Array.isArray(input.rows) ? input.rows : []) as ProposedRow[];
      const validated = await validateProductionRows(rows, ctx);
      const blocked = validated.some((r) => r.errors.length > 0);
      const output = {
        status: blocked ? "BLOCKED — fix errors before this can be confirmed" : "PREVIEW ready — awaiting the user's Confirm click. Do not write.",
        rows: validated.map((r) => ({ ...r.values, errors: r.errors, warnings: r.warnings })),
      };
      return { output, capturedPreview: { kind: "production", rows: validated, blocked } };
    }
    case "propose_issue": {
      const issue = await validateIssue(input as ProposedIssue, ctx);
      const blocked = issue.errors.length > 0;
      return {
        output: { status: blocked ? "BLOCKED" : "PREVIEW ready — awaiting Confirm.", issue: { ...issue.values, errors: issue.errors, warnings: issue.warnings } },
        capturedPreview: { kind: "issue", issue, blocked },
      };
    }
    case "propose_cell_update": {
      const u = { entity: String(input.entity || ""), row: Number(input.row), field: String(input.field || ""), value: String(input.value ?? "") };
      const v = validateUpdate(u);
      return {
        output: v.ok ? { status: "PREVIEW ready — awaiting Confirm.", update: u } : { status: "BLOCKED", error: v.error },
        capturedPreview: v.ok ? { kind: "update", update: u } : undefined,
      };
    }
    default:
      return { output: { error: `unknown tool ${name}` } };
  }
}

/* ------------------------------- confirm ---------------------------------- */

async function handleConfirm(confirm: { kind?: string; rows?: unknown; issue?: unknown; update?: unknown }) {
  if (confirm.kind === "production") {
    const rows = (Array.isArray(confirm.rows) ? confirm.rows : []) as ValidatedRow["values"][];
    if (rows.length === 0) return NextResponse.json({ error: "no_rows" }, { status: 400 });
    const r = await appendProductionRows(rows);
    return NextResponse.json({ ok: r.ok, written: r.results.filter((x) => x.ok).length, results: r.results });
  }
  if (confirm.kind === "issue") {
    const r = await logIssue((confirm.issue || {}) as Record<string, string>);
    return NextResponse.json({ ok: r.ok, reason: r.reason });
  }
  if (confirm.kind === "update") {
    const r = await updateCell(confirm.update as ProposedUpdate);
    return NextResponse.json({ ok: r.ok, reason: r.reason });
  }
  return NextResponse.json({ error: "bad_confirm" }, { status: 400 });
}

/* ---------------------------------- GET ----------------------------------- */
// GET /api/agent — report the caller's role access + remaining messages today.
// Auth via `Authorization: Bearer <idToken>`. Used by the assistant page on load.

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  let user: VerifiedUser;
  try {
    user = await verifyIdToken(token);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const role = await roleFor(user);
  const allowed = !!role && ALLOWED.includes(role);
  if (!allowed) return NextResponse.json({ allowed: false, role });
  const usage: UsageState = await peekUsage(user.uid, role);
  return NextResponse.json({
    allowed: true,
    role,
    remaining: usage.remaining,
    limit: usage.limit,
    llmConfigured: !!API_KEY,
  });
}
