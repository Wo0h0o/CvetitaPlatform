import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveStoreSchemas, fetchOrderPoints } from "@/lib/sales-queries";
import { getDateRange, type DatePreset } from "@/lib/dates";
import { logger } from "@/lib/logger";

// ============================================================
// GET /api/sales/geography/order-points
//
// Returns per-(lat, lng) office aggregates for the hierarchical
// zoom-driven dot view on /sales/geography. Powered by migration 042's
// `read_store_order_points` RPC. Only schemas whose Shopify webhooks
// deliver `shipping_address.latitude/longitude` produce rows here —
// foreign-store schemas (PII-redacted payloads) silently return nothing
// and are covered by the city-centroid fallback in /cities.
//
// The payload can be a few hundred KB for full БГ history; Next.js
// auto-gzips so over-the-wire is ~30-60 KB in practice. SWR caching
// in the client keeps re-renders cheap on metric/store toggles.
// ============================================================

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const params = req.nextUrl.searchParams;
    const storesParam = params.get("stores") || "all";
    const preset = (params.get("preset") as DatePreset) || "30d";
    const customFrom = params.get("from") || undefined;
    const customTo = params.get("to") || undefined;

    const { from, to } = getDateRange(preset, customFrom, customTo);
    const schemas = await resolveStoreSchemas(storesParam);
    const points = await fetchOrderPoints(schemas, from, to);

    return NextResponse.json(
      {
        points,
        dateRange: { from, to, preset },
        stores: schemas.map((s) => s.storeId),
      },
      { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=60" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("GET /api/sales/geography/order-points failed", { error: message });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
