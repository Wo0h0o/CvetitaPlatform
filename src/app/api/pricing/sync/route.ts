import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { refreshMaterials } from "@/lib/prim-pricing";
import { logger } from "@/lib/logger";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

async function run() {
  const r = await refreshMaterials();
  return NextResponse.json(r);
}

/** On-demand refresh of raw-material delivery prices from PRIM (button = auth, автоматизация = CRON_SECRET). */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") === `Bearer ${secret}`) {
    try {
      return await run();
    } catch (e) {
      logger.error("pricing/sync failed", { error: String(e) });
      return NextResponse.json({ error: "Sync failed" }, { status: 500 });
    }
  }
  const authError = await requireAuth(req);
  if (authError) return authError;
  try {
    return await run();
  } catch (e) {
    logger.error("pricing/sync failed", { error: String(e) });
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}

// GET also allowed with CRON_SECRET for easy triggering.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return await run();
  } catch (e) {
    logger.error("pricing/sync failed", { error: String(e) });
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
