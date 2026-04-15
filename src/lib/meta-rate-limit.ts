/**
 * Meta Business Use Case (BUC) rate-limit header parser.
 *
 * Meta tracks API usage on THREE axes per ad account:
 *   - call_count (API calls made)
 *   - total_cputime (CPU ms consumed — this trips first for heavy insights)
 *   - total_time (wall time ms consumed)
 *
 * Each axis is a 0-100 percentage of the hourly budget. We throttle when
 * the PEAK across the three exceeds `THROTTLE_THRESHOLD`, not the average.
 *
 * Reference: https://developers.facebook.com/docs/graph-api/overview/rate-limiting
 */

import { logger } from "./logger";

export const THROTTLE_THRESHOLD = 75; // back off at 75% usage
export const HARD_LIMIT_THRESHOLD = 95; // stop entirely at 95%

interface BucAccountUsage {
  type?: string;
  call_count?: number;
  total_cputime?: number;
  total_time?: number;
  estimated_time_to_regain_access?: number;
}

export interface BucUsage {
  accountId: string;       // 'act_...' or raw numeric id
  peakPct: number;         // max(call_count, total_cputime, total_time)
  callCount: number;
  totalCputime: number;
  totalTime: number;
  estimatedRecoverSec: number;
}

/**
 * Parses the `X-Business-Use-Case-Usage` response header.
 * Returns a per-account usage record, or null if the header is missing/unparseable.
 */
export function parseBucHeader(header: string | null): Map<string, BucUsage> {
  const out = new Map<string, BucUsage>();
  if (!header) return out;

  let parsed: Record<string, BucAccountUsage[]>;
  try {
    parsed = JSON.parse(header);
  } catch (e) {
    logger.warn("BUC header parse failed", { error: (e as Error).message });
    return out;
  }

  for (const [accountId, usages] of Object.entries(parsed)) {
    if (!Array.isArray(usages) || usages.length === 0) continue;
    // Take the highest reading across all BUC types for this account
    const peak = usages.reduce<BucUsage>(
      (acc, u) => {
        const call = u.call_count ?? 0;
        const cpu = u.total_cputime ?? 0;
        const time = u.total_time ?? 0;
        const p = Math.max(call, cpu, time);
        if (p > acc.peakPct) {
          return {
            accountId,
            peakPct: p,
            callCount: call,
            totalCputime: cpu,
            totalTime: time,
            estimatedRecoverSec: u.estimated_time_to_regain_access ?? 0,
          };
        }
        return acc;
      },
      {
        accountId,
        peakPct: 0,
        callCount: 0,
        totalCputime: 0,
        totalTime: 0,
        estimatedRecoverSec: 0,
      }
    );
    out.set(accountId, peak);
  }

  return out;
}

/**
 * Policy decision based on a BucUsage reading.
 *   - 'ok'        → below throttle threshold, continue normally
 *   - 'throttle'  → between throttle and hard limit, sleep briefly before next call
 *   - 'stop'      → above hard limit, abort this account for the current run
 */
export type ThrottleDecision = "ok" | "throttle" | "stop";

export function decide(usage: BucUsage | undefined): ThrottleDecision {
  if (!usage) return "ok";
  if (usage.peakPct >= HARD_LIMIT_THRESHOLD) return "stop";
  if (usage.peakPct >= THROTTLE_THRESHOLD) return "throttle";
  return "ok";
}

/**
 * Sleep helper for throttle decisions. Uses the estimatedRecoverSec hint when
 * available (capped at 30s so we never block a whole cron run on one account),
 * otherwise a short default.
 */
export async function sleepForThrottle(usage: BucUsage): Promise<void> {
  const hintSec = Math.min(usage.estimatedRecoverSec || 0, 30);
  const delayMs = hintSec > 0 ? hintSec * 1000 : 2_000;
  await new Promise((r) => setTimeout(r, delayMs));
}

/**
 * Convenience: wrap a Response and return both the parsed JSON and BUC usage.
 * Used by sync helpers so every fetch site automatically records rate state.
 */
export async function parseResponseWithBuc<T>(
  res: Response
): Promise<{ data: T | null; usage: Map<string, BucUsage> }> {
  const usage = parseBucHeader(res.headers.get("x-business-use-case-usage"));
  if (!res.ok) {
    return { data: null, usage };
  }
  try {
    const data = (await res.json()) as T;
    return { data, usage };
  } catch {
    return { data: null, usage };
  }
}
