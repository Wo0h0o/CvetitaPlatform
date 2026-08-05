import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/api-auth";
import { refreshForecast } from "@/lib/prim-forecast";
import { logger } from "@/lib/logger";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/refresh-forecast
 * Pulls PRIM data over MCP, recomputes the inventory forecast + recipes,
 * stores today's snapshot. Runs daily via Vercel Cron (see vercel.json).
 * Also triggerable manually with the CRON_SECRET.
 */
export async function GET(req: Request) {
  const cronError = requireCronSecret(req);
  if (cronError) return cronError;

  const started = Date.now();
  try {
    const result = await refreshForecast();
    return NextResponse.json({ ...result, durationMs: Date.now() - started });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("refresh-forecast cron failed", { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
