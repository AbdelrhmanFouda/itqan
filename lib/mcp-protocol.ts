/**
 * The Model Context Protocol, the part of it the connector speaks
 * (2026-09-28). JSON-RPC 2.0 over "streamable HTTP", answered as plain JSON —
 * no SSE stream, no session: every POST is complete in itself, which is what
 * a serverless function wants.
 *
 * Methods: initialize, ping, tools/list, tools/call. Notifications
 * (notifications/initialized, …) have no id and get no answer — the route
 * replies 202. Anything else is -32601.
 *
 * Pure, zero imports — the tools and their runner are passed in, so
 * tests/mcp.test.ts drives the whole exchange without the sheet.
 */

export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export type ToolDef = {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
};

export type ServerSpec = {
  name: string;
  version: string;
  instructions: string;
  tools: ToolDef[];
  /** Runs a tool. A returned object with an `error` key is a tool-level
   *  failure (isError), shown to Claude — not a protocol error. */
  run: (name: string, args: Record<string, unknown>) => Promise<unknown>;
};

type RpcMessage = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
export type RpcResponse =
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | { jsonrpc: "2.0"; id: string | number | null; error: { code: number; message: string } };

/** A tool answer bigger than this is cut — one answer should never fill
 *  Claude's context. The tools page with `limit`/`offset` before this bites. */
export const MAX_TEXT = 200_000;

const rpcError = (id: RpcResponse["id"], code: number, message: string): RpcResponse =>
  ({ jsonrpc: "2.0", id, error: { code, message } });

const idOf = (m: RpcMessage): RpcResponse["id"] =>
  typeof m.id === "string" || typeof m.id === "number" ? m.id : null;

export function negotiateVersion(asked: unknown): string {
  return typeof asked === "string" && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0];
}

export function toolText(value: unknown): { text: string; isError: boolean } {
  const isError = !!value && typeof value === "object" && "error" in (value as object);
  let text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === undefined) text = "null";
  if (text.length > MAX_TEXT) {
    text = text.slice(0, MAX_TEXT) + `\n…[cut at ${MAX_TEXT} characters — ask again with a smaller limit or a search]`;
  }
  return { text, isError };
}

/** One JSON-RPC message → its response, or null for a notification. */
export async function handleRpc(msg: unknown, spec: ServerSpec): Promise<RpcResponse | null> {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return rpcError(null, -32600, "Invalid Request");
  const m = msg as RpcMessage;
  if (m.jsonrpc !== "2.0" || typeof m.method !== "string") return rpcError(idOf(m), -32600, "Invalid Request");
  // No id → a notification. Nothing is owed, whatever the method.
  if (m.id === undefined) return null;
  const id = idOf(m);
  const params = (m.params && typeof m.params === "object" ? m.params : {}) as Record<string, unknown>;

  switch (m.method) {
    case "initialize":
      return {
        jsonrpc: "2.0", id,
        result: {
          protocolVersion: negotiateVersion(params.protocolVersion),
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: spec.name, version: spec.version },
          instructions: spec.instructions,
        },
      };
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: spec.tools } };
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      if (!spec.tools.some((t) => t.name === name)) return rpcError(id, -32602, `Unknown tool: ${name || "(none)"}`);
      const args = (params.arguments && typeof params.arguments === "object" ? params.arguments : {}) as Record<string, unknown>;
      let out: { text: string; isError: boolean };
      try {
        out = toolText(await spec.run(name, args));
      } catch (err) {
        out = { text: `Tool failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
      }
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: out.text }], isError: out.isError } };
    }
    default:
      return rpcError(id, -32601, `Method not found: ${m.method}`);
  }
}
