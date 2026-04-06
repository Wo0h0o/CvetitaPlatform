import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { fetchActiveStores } from "@/lib/sales-queries";
import { logger } from "@/lib/logger";

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const stores = await fetchActiveStores();

    return NextResponse.json(
      { stores },
      {
        headers: {
          "Cache-Control": "s-maxage=300, stale-while-revalidate=60",
        },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("GET /api/stores failed", { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
