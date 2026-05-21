import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveStoreSchemas, fetchHourWeekday } from "@/lib/sales-queries";
import { getDateRange, type DatePreset } from "@/lib/dates";
import { logger } from "@/lib/logger";

// ============================================================
// GET /api/sales/hour-weekday
//
// Returns a dense 168-bucket array (7 weekdays × 24 hours, ISO Mon=1)
// summed across the selected stores over [from, to].
//
// Used by the SalesHourHeatmap component on /sales — answers "when do
// our customers buy?". Always 168 rows even on zero-volume periods, so
// the client doesn't need to defensive-pad.
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
    const buckets = await fetchHourWeekday(schemas, from, to);

    return NextResponse.json(
      {
        buckets,
        dateRange: { from, to, preset },
        stores: schemas.map((s) => s.storeId),
      },
      { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=60" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("GET /api/sales/hour-weekday failed", { error: message });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
