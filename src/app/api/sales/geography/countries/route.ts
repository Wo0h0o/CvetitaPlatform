import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveStoreSchemas, fetchSalesByCountry } from "@/lib/sales-queries";
import { getDateRange, type DatePreset } from "@/lib/dates";
import { logger } from "@/lib/logger";

// ============================================================
// GET /api/sales/geography/countries
//
// Returns sales aggregated by shipping country (ISO alpha-2). One row
// per country actually shipped to in the window, sorted descending by
// revenue. Powers the /sales/geography world-map view.
//
// Note: customers are summed across schemas (single-store-exact /
// multi-store-upper-bound). Acceptable for v1 — a true cross-schema
// DISTINCT would require staging customer emails into a temp table per
// request.
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
    const countries = await fetchSalesByCountry(schemas, from, to);

    return NextResponse.json(
      {
        countries,
        dateRange: { from, to, preset },
        stores: schemas.map((s) => s.storeId),
      },
      { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=60" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("GET /api/sales/geography/countries failed", { error: message });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
