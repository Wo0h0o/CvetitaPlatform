import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveStoreSchemas, fetchStoreOrders } from "@/lib/sales-queries";
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
    const limit = Math.min(Number(sp.get("limit")) || 50, 200);
    const offset = Number(sp.get("offset")) || 0;

    const { from, to } = getDateRange(preset, customFrom, customTo);
    const schemas = await resolveStoreSchemas(storeId);

    if (schemas.length === 0) {
      return NextResponse.json({ error: "Store not found" }, { status: 404 });
    }

    const { orders, total } = await fetchStoreOrders(schemas[0], from, to, limit, offset);

    return NextResponse.json(
      { orders, total, limit, offset, dateRange: { from, to, preset } },
      { headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=30" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("GET /api/sales/store/[storeId]/orders failed", { error: message });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
