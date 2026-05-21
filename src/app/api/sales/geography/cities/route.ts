import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveStoreSchemas, fetchSalesByCity } from "@/lib/sales-queries";
import { getDateRange, type DatePreset } from "@/lib/dates";
import { logger } from "@/lib/logger";

// ============================================================
// GET /api/sales/geography/cities
//
// Returns sales aggregated by (country, city) tuple — feeds the pulsing
// dot overlay on /sales/geography. Alias normalisation + lat/lng
// resolution happens client-side against src/lib/geo/cities.ts so the
// alias table can iterate without redeploying the DB.
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
    const cities = await fetchSalesByCity(schemas, from, to);

    return NextResponse.json(
      {
        cities,
        dateRange: { from, to, preset },
        stores: schemas.map((s) => s.storeId),
      },
      { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=60" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("GET /api/sales/geography/cities failed", { error: message });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
