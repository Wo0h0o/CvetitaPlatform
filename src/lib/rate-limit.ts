/**
 * In-memory sliding-window rate limiter.
 *
 * Limitation: per-instance — each Vercel cold start resets the map.
 * Protects against rapid-fire abuse within a warm instance.
 * Redis-backed rate limiting will come with Supabase.
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "./logger";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();
let callsSincePrune = 0;

function getClientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
}

/**
 * Check rate limit. Returns a 429 Response if exceeded, or null if allowed.
 *
 * Usage:
 *   const limited = rateLimit(req, { limit: 20, windowMs: 60_000 });
 *   if (limited) return limited;
 */
export function rateLimit(
  req: NextRequest,
  options: { limit: number; windowMs: number }
): NextResponse | null {
  const { limit, windowMs } = options;
  const ip = getClientIp(req);
  const key = `${ip}:${req.nextUrl.pathname}`;
  const now = Date.now();

  // Prune expired entries periodically
  callsSincePrune++;
  if (callsSincePrune >= 100) {
    callsSincePrune = 0;
    for (const [k, v] of store) {
      if (now > v.resetAt) store.delete(k);
    }
  }

  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  entry.count++;

  if (entry.count > limit) {
    logger.security("Rate limit exceeded", { ip, path: req.nextUrl.pathname, count: entry.count, limit });
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfter) },
      }
    );
  }

  return null;
}
