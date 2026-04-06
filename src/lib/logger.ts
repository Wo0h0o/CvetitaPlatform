/**
 * Structured logger for Vercel (JSON to stdout).
 * Never log tokens, API keys, or customer PII.
 */

import type { NextRequest } from "next/server";

type LogLevel = "info" | "warn" | "error" | "security";

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

function emit(entry: LogEntry): void {
  const line = JSON.stringify(entry);
  if (entry.level === "error" || entry.level === "security") {
    console.error(line);
  } else if (entry.level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  emit({
    level,
    message,
    timestamp: new Date().toISOString(),
    context,
  });
}

/**
 * Extract safe request metadata (no tokens, no secrets).
 */
export function requestMeta(req: NextRequest | Request): Record<string, string> {
  const headers = req.headers;
  return {
    ip: headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown",
    userAgent: headers.get("user-agent") || "unknown",
    path: req instanceof Request ? new URL(req.url).pathname : (req as NextRequest).nextUrl.pathname,
    method: req.method,
  };
}

export const logger = {
  info: (message: string, context?: Record<string, unknown>) => log("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => log("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => log("error", message, context),
  security: (message: string, context?: Record<string, unknown>) => log("security", message, context),
};
