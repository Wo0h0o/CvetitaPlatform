import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/**
 * PRIM ERP client over its MCP (Model Context Protocol) interface.
 *
 * PRIM exposes its API only via MCP (OAuth scope "mcp"), using an
 * authorization_code + PKCE flow with a one-time admin approval. After that
 * one-time connect we hold a rotating refresh_token (in Supabase prim_auth)
 * and mint short-lived access tokens for unattended (cron) access.
 */

const BASE = process.env.PRIM_BASE!;
const CLIENT_ID = process.env.PRIM_CLIENT_ID!;
const CLIENT_SECRET = process.env.PRIM_CLIENT_SECRET!;

/** Refresh the access token using the stored (rotating) refresh_token. */
async function refreshAccessToken(): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("prim_auth")
    .select("refresh_token")
    .eq("id", 1)
    .maybeSingle();
  if (error || !data?.refresh_token) {
    throw new Error("PRIM not connected (no refresh_token). Visit /production/connect.");
  }

  const res = await fetch(`${BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: data.refresh_token,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  const tok = await res.json();
  if (!res.ok || !tok.access_token) {
    logger.error("PRIM token refresh failed", { status: res.status });
    throw new Error("PRIM token refresh failed");
  }
  // refresh_token rotates — persist the new one
  if (tok.refresh_token) {
    await supabaseAdmin
      .from("prim_auth")
      .update({ refresh_token: tok.refresh_token, updated_at: new Date().toISOString() })
      .eq("id", 1);
  }
  return tok.access_token as string;
}

/** Parse an MCP HTTP response body (plain JSON or SSE "data:" frame). */
function parseMcpBody(text: string): unknown {
  let body = text;
  if (text.includes("data:")) {
    const line = text.split("\n").find((l) => l.startsWith("data:"));
    if (line) body = line.slice(5).trim();
  }
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

export interface PrimClient {
  callTool: <T = unknown>(name: string, args: Record<string, unknown>) => Promise<T>;
}

/** Open an authenticated MCP session and return a tool-caller. */
export async function connectPrim(): Promise<PrimClient> {
  const access = await refreshAccessToken();

  const post = (body: unknown, sid?: string) =>
    fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${access}`,
        ...(sid ? { "Mcp-Session-Id": sid } : {}),
      },
      body: JSON.stringify(body),
    });

  // initialize
  const initRes = await post({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "cvetita-command-center", version: "1.0" } },
  });
  const sid = initRes.headers.get("mcp-session-id") ?? undefined;
  await initRes.text();
  // required notification
  await post({ jsonrpc: "2.0", method: "notifications/initialized" }, sid).catch(() => {});

  let seq = 2;
  return {
    async callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
      const res = await post({ jsonrpc: "2.0", id: seq++, method: "tools/call", params: { name, arguments: args } }, sid);
      const parsed = parseMcpBody(await res.text()) as {
        result?: { content?: { text?: string }[]; isError?: boolean };
        error?: { message?: string };
      };
      if (parsed?.error) throw new Error(`PRIM ${name}: ${parsed.error.message}`);
      const text = parsed?.result?.content?.[0]?.text ?? "";
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as unknown as T;
      }
    },
  };
}
