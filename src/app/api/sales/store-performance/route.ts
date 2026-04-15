import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveStoreSchemas, fetchStorePerformance } from "@/lib/sales-queries";
import { getDateRange, type DatePreset } from "@/lib/dates";
import { logger } from "@/lib/logger";

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const params = req.nextUrl.searchParams;
    const preset = (params.get("preset") as DatePreset) || "30d";
    const customFrom = params.get("from") || undefined;
    const customTo = params.get("to") || undefined;

    const { from, to, compFrom, compTo } = getDateRange(preset, customFrom, customTo);
    const schemas = await resolveStoreSchemas("all");
    const stores = await fetchStorePerformance(schemas, from, to, compFrom, compTo);

    return NextResponse.json(
      { stores, dateRange: { from, to, preset } },
      { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=60" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("GET /api/sales/store-performance failed", { error: message });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
