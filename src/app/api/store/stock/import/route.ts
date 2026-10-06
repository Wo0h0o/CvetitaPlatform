import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getStoreContext } from "@/lib/store-auth";
import { importSoToStock } from "@/lib/store-stock";
import { logger } from "@/lib/logger";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

/** POST {store_id, so_num} → внася начално зареждане от PRIM продажба. Само admin/manager. */
export async function POST(req: NextRequest) {
  const ctx = await getStoreContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.canAllStores) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const store = Number(body.store_id);
  const soNum = String(body.so_num || "").trim().toUpperCase();
  if (!store || !soNum) return NextResponse.json({ error: "store_id и so_num са задължителни" }, { status: 400 });
  try {
    const r = await importSoToStock(store, soNum);
    return NextResponse.json(r);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("store stock import failed", { error: msg, soNum });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
