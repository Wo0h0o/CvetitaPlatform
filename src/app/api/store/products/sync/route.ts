import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/api-auth";
import { syncStoreProducts } from "@/lib/store-products";
import { logger } from "@/lib/logger";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

/** GET — ресинк на магазинните продукти от ПРИМ (с CRON_SECRET; също дневен cron). */
export async function GET(req: Request) {
  const cronError = requireCronSecret(req);
  if (cronError) return cronError;
  try {
    const r = await syncStoreProducts();
    return NextResponse.json(r);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("store products sync (cron) failed", { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
