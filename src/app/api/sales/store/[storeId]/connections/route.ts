import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { fetchStoreConnections } from "@/lib/sales-queries";
import { logger } from "@/lib/logger";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ storeId: string }> }
) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const { storeId } = await params;
    const result = await fetchStoreConnections(storeId);

    return NextResponse.json(result, {
      headers: { "Cache-Control": "s-maxage=600, stale-while-revalidate=120" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("GET /api/sales/store/[storeId]/connections failed", { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
