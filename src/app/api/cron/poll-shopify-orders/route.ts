import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadStoreConfig } from "@/lib/store-config-loader";
import { pollShopifyOrders } from "@/lib/sync/poll-shopify-orders";
import { logger } from "@/lib/logger";

/**
 * GET /api/cron/poll-shopify-orders
 *
 * Hourly Vercel cron. Pulls orders updated since stores.settings.last_orders_poll_at
 * for every active Shopify store and upserts via the standard normalised pipeline.
 *
 * This bridge exists because real-time webhooks fail HMAC verification — the
 * client_secret in store_credentials is the wrong credential type. Until
 * that's corrected, polling keeps the dashboard fresh with at most ~1h lag.
 *
 * Cursor: stored per store in stores.settings.last_orders_poll_at. On first
 * run (cursor missing) we look back 24h. On success the cursor is advanced
 * to MAX(orders.updated_at) we just saw, OR to (now - 5min) if the page was
 * empty (5-min overlap absorbs Shopify's eventual consistency window).
 */

const FIRST_RUN_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const OVERLAP_MS = 5 * 60 * 1000;

export const maxDuration = 60;

export async function GET(req: Request) {
  const cronError = requireCronSecret(req);
  if (cronError) return cronError;

  const startedAt = Date.now();

  const { data: stores, error: storesErr } = await supabaseAdmin
    .from("stores")
    .select("id, market_code, settings")
    .eq("is_active", true)
    .eq("platform", "shopify");

  if (storesErr) {
    logger.error("poll-shopify-orders: stores fetch failed", { error: storesErr.message });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  const results: Array<{
    market: string;
    sinceISO: string;
    fetched: number;
    inserted: number;
    skipped: number;
    errors: number;
    cursorAdvancedTo: string;
    durationMs: number;
    errorMsg?: string;
  }> = [];

  for (const store of stores ?? []) {
    const storeStart = Date.now();
    const settings = (store.settings as Record<string, unknown>) || {};
    // Skip Meta-only placeholders (stores that hold a Meta binding but no
    // Shopify credentials yet — e.g. HU before its shop comes online).
    if (settings.meta_only === true) {
      continue;
    }
    const lastIso = typeof settings.last_orders_poll_at === "string"
      ? (settings.last_orders_poll_at as string)
      : null;
    const sinceISO = lastIso ?? new Date(Date.now() - FIRST_RUN_LOOKBACK_MS).toISOString();

    try {
      const config = await loadStoreConfig(store.id);
      const result = await pollShopifyOrders(config, sinceISO);

      // Cursor: pick the highest updated_at we observed; if no rows, slide
      // forward to (now - overlap) so we don't re-scan the same window forever.
      const advancedTo =
        result.latestUpdatedAt
          ?? new Date(Date.now() - OVERLAP_MS).toISOString();

      const newSettings = { ...settings, last_orders_poll_at: advancedTo };
      const { error: updErr } = await supabaseAdmin
        .from("stores")
        .update({ settings: newSettings })
        .eq("id", store.id);
      if (updErr) {
        logger.error("poll-shopify-orders: cursor update failed", {
          storeId: store.id,
          error: updErr.message,
        });
      }

      results.push({
        market: store.market_code,
        sinceISO,
        fetched: result.fetched,
        inserted: result.inserted,
        skipped: result.skipped,
        errors: result.errors,
        cursorAdvancedTo: advancedTo,
        durationMs: Date.now() - storeStart,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("poll-shopify-orders: store failed", {
        storeId: store.id,
        market: store.market_code,
        error: message,
      });
      results.push({
        market: store.market_code,
        sinceISO,
        fetched: 0,
        inserted: 0,
        skipped: 0,
        errors: 1,
        cursorAdvancedTo: sinceISO,
        durationMs: Date.now() - storeStart,
        errorMsg: message,
      });
    }
  }

  const insertedTotal = results.reduce((s, r) => s + r.inserted, 0);

  // Refresh aggregates only if anything new arrived (cheap call still, but
  // skip the noise when nothing happened).
  if (insertedTotal > 0) {
    for (const store of stores ?? []) {
      const schema = `store_${store.market_code}`;
      const { error } = await supabaseAdmin.rpc("refresh_daily_aggregates", {
        p_schema: schema,
      });
      if (error) {
        logger.error("poll-shopify-orders: refresh_daily_aggregates failed", {
          schema,
          error: error.message,
        });
      }
    }
  }

  const durationMs = Date.now() - startedAt;
  logger.info("poll-shopify-orders cron completed", {
    storesProcessed: results.length,
    insertedTotal,
    durationMs,
  });

  return NextResponse.json({
    ok: true,
    storesProcessed: results.length,
    insertedTotal,
    durationMs,
    results,
  });
}
