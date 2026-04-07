import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveStoreSchemas, fetchTopProducts } from "@/lib/sales-queries";
import { getDateRange, type DatePreset } from "@/lib/dates";
import { logger } from "@/lib/logger";

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const params = req.nextUrl.searchParams;
    const storesParam = params.get("stores") || "all";
    const preset = (params.get("preset") as DatePreset) || "30d";
    const customFrom = params.get("from") || undefined;
    const customTo = params.get("to") || undefined;
    const limit = Math.min(Number(params.get("limit")) || 10, 50);

    const { from, to } = getDateRange(preset, customFrom, customTo);
    const schemas = await resolveStoreSchemas(storesParam);
    const products = await fetchTopProducts(schemas, from, to, limit);

    return NextResponse.json(
      { products, dateRange: { from, to, preset }, stores: schemas.map((s) => s.storeId) },
      { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=60" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("GET /api/sales/top-products failed", { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
