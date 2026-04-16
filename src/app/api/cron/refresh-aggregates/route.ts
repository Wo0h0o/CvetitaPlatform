import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/**
 * GET /api/cron/refresh-aggregates
 *
 * Refreshes daily_aggregates for all active stores.
 * Called by Vercel Cron every 15 minutes.
 *
 * The refresh function (public.refresh_daily_aggregates) computes
 * revenue, orders, AOV, refunds, and top products from the append-only
 * orders table using DISTINCT ON for latest state per order.
 */
export async function GET(req: Request) {
  const cronError = requireCronSecret(req);
  if (cronError) return cronError;

  const startedAt = Date.now();

  // Fetch all active stores to get their schema names
  const { data: stores, error: storesErr } = await supabaseAdmin
    .from("stores")
    .select("id, market_code")
    .eq("is_active", true);

  if (storesErr) {
    logger.error("refresh-aggregates: failed to load stores", {
      error: storesErr.message,
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  const results: Array<{
    market: string;
    schema: string;
    ok: boolean;
    error?: string;
  }> = [];

  // Refresh each store sequentially (low frequency, no need for parallelism)
  for (const store of stores ?? []) {
    const schema = `store_${store.market_code}`;
    try {
      const { error: rpcErr } = await supabaseAdmin.rpc(
        "refresh_daily_aggregates",
        { p_schema: schema }
      );

      if (rpcErr) {
        logger.error("refresh-aggregates: RPC failed", {
          schema,
          error: rpcErr.message,
        });
        results.push({ market: store.market_code, schema, ok: false, error: rpcErr.message });
      } else {
        results.push({ market: store.market_code, schema, ok: true });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("refresh-aggregates: unexpected error", { schema, error: msg });
      results.push({ market: store.market_code, schema, ok: false, error: msg });
    }
  }

  const durationMs = Date.now() - startedAt;
  const succeeded = results.filter((r) => r.ok).length;

  logger.info("refresh-aggregates cron completed", {
    storesProcessed: results.length,
    succeeded,
    durationMs,
  });

  return NextResponse.json({
    ok: succeeded === results.length,
    storesProcessed: results.length,
    succeeded,
    durationMs,
    results,
  });
}
