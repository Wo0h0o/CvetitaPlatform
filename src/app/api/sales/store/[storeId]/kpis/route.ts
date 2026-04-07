import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveStoreSchemas, fetchSalesKpis } from "@/lib/sales-queries";
import { getDateRange, type DatePreset } from "@/lib/dates";
import { logger } from "@/lib/logger";

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

    const { from, to, compFrom, compTo } = getDateRange(preset, customFrom, customTo);
    const schemas = await resolveStoreSchemas(storeId);
    const kpis = await fetchSalesKpis(schemas, from, to, compFrom, compTo);

    return NextResponse.json(
      { ...kpis, dateRange: { from, to, preset } },
      { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=60" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("GET /api/sales/store/[storeId]/kpis failed", { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
