import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveStoreSchemas, fetchSalesTrend } from "@/lib/sales-queries";
import { getDateRange, type DatePreset } from "@/lib/dates";
import { logger } from "@/lib/logger";

const VALID_GRANULARITY = new Set(["day", "week", "month"]);

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const params = req.nextUrl.searchParams;
    const storesParam = params.get("stores") || "all";
    const preset = (params.get("preset") as DatePreset) || "30d";
    const customFrom = params.get("from") || undefined;
    const customTo = params.get("to") || undefined;
    const granularityRaw = params.get("granularity") || "day";
    const granularity = VALID_GRANULARITY.has(granularityRaw)
      ? (granularityRaw as "day" | "week" | "month")
      : "day";

    const { from, to } = getDateRange(preset, customFrom, customTo);

    const schemas = await resolveStoreSchemas(storesParam);
    const series = await fetchSalesTrend(schemas, from, to, granularity);

    return NextResponse.json(
      {
        series,
        granularity,
        stores: schemas.map((s) => s.storeId),
      },
      {
        headers: {
          "Cache-Control": "s-maxage=300, stale-while-revalidate=60",
        },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("GET /api/sales/trend failed", { error: message });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
