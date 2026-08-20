import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { refreshForecast } from "@/lib/prim-forecast";
import { logger } from "@/lib/logger";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * POST /api/production/sync
 * On-demand refresh from PRIM (same as the daily cron): recomputes the
 * forecast + recipes and reconciles produced quantities on open orders.
 * Auth: logged-in user. Lets staff pull the latest production immediately
 * instead of waiting for the scheduled run.
 */
export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const started = Date.now();
  try {
    const result = await refreshForecast();
    return NextResponse.json({ ...result, durationMs: Date.now() - started });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("production/sync failed", { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
