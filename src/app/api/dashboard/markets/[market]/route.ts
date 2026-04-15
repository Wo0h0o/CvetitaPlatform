import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveMarket } from "@/lib/store-market-resolver";
import { logger } from "@/lib/logger";

// ============================================================
// GET /api/dashboard/markets/[market]
// ============================================================
//
// Thin client-facing wrapper around `resolveMarket()`. Used by:
//   - /ads/[market]/page.tsx — to render sub-brand filter labels derived
//     from bindings[].role (primary → Cvetita, secondary → ProteinBar,
//     legacy → Архив). Hidden for markets with a single binding.
//   - TopBarStoreSwitcher — for validating that a market code actually
//     resolves (so we can hide the switcher for unknown markets).
//
// Deliberately *not* exposing credentials or external account ids directly
// from the resolver — just the shape the UI needs for filtering + labels.

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ market: string }> }
) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const { market } = await params;

  try {
    const resolved = await resolveMarket(market);
    return NextResponse.json(
      {
        storeId: resolved.storeId,
        marketCode: resolved.marketCode,
        storeName: resolved.storeName,
        bindings: resolved.bindings,
      },
      { headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=30" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    // Not found / invalid market code → 404 so the page can render a clear
    // "Market not found" state instead of a generic 500.
    if (msg.includes("No active store") || msg.includes("No primary")) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    logger.error("GET /api/dashboard/markets/[market] failed", { market, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
