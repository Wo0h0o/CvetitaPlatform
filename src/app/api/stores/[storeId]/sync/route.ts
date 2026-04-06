import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadStoreConfig } from "@/lib/store-config-loader";
import { syncOrders } from "@/lib/sync/shopify-order-sync";
import { syncProducts } from "@/lib/sync/shopify-product-sync";
import { SyncProgressTracker } from "@/lib/sync/sync-progress";
import { logger } from "@/lib/logger";

// Allow up to 5 minutes for large syncs (requires Vercel Pro)
export const maxDuration = 300;

interface SyncRequestBody {
  type: "orders" | "products" | "all";
  daysBack?: number;
}

/**
 * POST /api/stores/[storeId]/sync
 *
 * Triggers initial sync or re-sync for a store.
 * Body: { type: "orders" | "products" | "all", daysBack?: number }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ storeId: string }> }
) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const { storeId } = await params;

  // Parse body
  let body: SyncRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const syncType = body.type || "all";
  if (!["orders", "products", "all"].includes(syncType)) {
    return NextResponse.json(
      { error: "type must be 'orders', 'products', or 'all'" },
      { status: 400 }
    );
  }

  // Load store config (validates store exists + credentials)
  let config: Awaited<ReturnType<typeof loadStoreConfig>>;
  try {
    config = await loadStoreConfig(storeId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Store not found";
    return NextResponse.json({ error: message }, { status: 404 });
  }

  // Concurrent sync guard — check if a sync is already running
  const { data: storeData } = await supabaseAdmin
    .from("stores")
    .select("settings")
    .eq("id", storeId)
    .single();

  const settings = (storeData?.settings as Record<string, unknown>) || {};
  const lastOrderSync = settings.last_sync_orders as { status?: string } | undefined;
  const lastProductSync = settings.last_sync_products as { status?: string } | undefined;

  if (lastOrderSync?.status === "running" || lastProductSync?.status === "running") {
    return NextResponse.json(
      { error: "Sync already in progress for this store" },
      { status: 409 }
    );
  }

  // Execute sync
  const results: Record<string, number> = {};

  try {
    if (syncType === "products" || syncType === "all") {
      const productTracker = new SyncProgressTracker(storeId, "products");
      results.products = await syncProducts(config, productTracker);
    }

    if (syncType === "orders" || syncType === "all") {
      const orderTracker = new SyncProgressTracker(storeId, "orders");
      results.orders = await syncOrders(
        config,
        orderTracker,
        body.daysBack || 90
      );
    }

    // Refresh daily aggregates after data lands
    await supabaseAdmin.rpc("refresh_daily_aggregates", {
      p_schema: config.schemaName,
    });

    logger.info("Store sync completed", { storeId, results });

    return NextResponse.json({
      ok: true,
      storeId,
      synced: results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    logger.error("Store sync failed", { storeId, error: message });

    return NextResponse.json(
      { error: message, partial: results },
      { status: 500 }
    );
  }
}
