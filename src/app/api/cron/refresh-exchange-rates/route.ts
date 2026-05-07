import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/api-auth";
import { refreshDailyRates } from "@/lib/exchange-rates";
import { logger } from "@/lib/logger";

/**
 * GET /api/cron/refresh-exchange-rates
 *
 * Pulls today's ECB reference rates and upserts into public.exchange_rates.
 * Called once per day after the ECB publishes (around 16:00 CET on TARGET2
 * working days). Weekends and holidays are no-ops — the daily XML keeps
 * returning the most recent working-day's snapshot, and our upsert is
 * idempotent.
 */
export async function GET(req: Request) {
  const cronError = requireCronSecret(req);
  if (cronError) return cronError;

  const startedAt = Date.now();
  try {
    const rowsUpserted = await refreshDailyRates();
    const durationMs = Date.now() - startedAt;
    logger.info("refresh-exchange-rates cron completed", { rowsUpserted, durationMs });
    return NextResponse.json({ ok: true, rowsUpserted, durationMs });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("refresh-exchange-rates cron failed", { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
