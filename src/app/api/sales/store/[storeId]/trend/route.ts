import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveStoreSchemas, fetchSalesTrend } from "@/lib/sales-queries";
import { getDateRange, type DatePreset } from "@/lib/dates";
import { logger } from "@/lib/logger";

const VALID_GRANULARITIES = new Set(["day", "week", "month"]);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ storeId: string }> }
) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const { storeId } = await params;
    const sp = req.nextUrl.searchParams;
    const preset = (sp.get("preset") as DatePreset) || "30d";
    const customFrom = sp.get("from") || undefined;
    const customTo = sp.get("to") || undefined;
    const granularity = sp.get("granularity") || "day";

    if (!VALID_GRANULARITIES.has(granularity)) {
      return NextResponse.json({ error: "Invalid granularity" }, { status: 400 });
    }

    const { from, to } = getDateRange(preset, customFrom, customTo);
    const schemas = await resolveStoreSchemas(storeId);
    const series = await fetchSalesTrend(schemas, from, to, granularity as "day" | "week" | "month");

    return NextResponse.json(
      { series, granularity },
      { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=60" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("GET /api/sales/store/[storeId]/trend failed", { error: message });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
