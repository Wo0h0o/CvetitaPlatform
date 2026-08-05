import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth, requireCronSecret } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/**
 * Inventory forecast snapshot bridge.
 *
 * The forecast is computed locally (needs the PRIM ERP connector, which the
 * Vercel app can't reach). The local morning routine POSTs the computed
 * snapshot here; the /production page GETs the latest one to display.
 *
 * POST  — store a new snapshot. Auth: CRON_SECRET (Bearer).
 * GET   — return the latest snapshot. Auth: logged-in user.
 */

interface ForecastPayload {
  as_of: string;
  buckets: { crit: number; order: number; watch: number; ok: number };
  singles: unknown[];
  bundles: unknown[];
  noStock: unknown[];
}

export async function POST(req: NextRequest) {
  const cronError = requireCronSecret(req);
  if (cronError) return cronError;

  let body: ForecastPayload;
  try {
    body = (await req.json()) as ForecastPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body.as_of !== "string" || !Array.isArray(body.singles)) {
    return NextResponse.json(
      { error: "Missing required fields (as_of, singles[])" },
      { status: 400 }
    );
  }

  const { error } = await supabaseAdmin
    .from("inventory_forecast")
    .insert({ as_of: body.as_of, payload: body });

  if (error) {
    logger.error("production/forecast: insert failed", { error: error.message });
    return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  }

  logger.info("production/forecast: snapshot stored", {
    as_of: body.as_of,
    singles: body.singles.length,
  });
  return NextResponse.json({ ok: true, as_of: body.as_of });
}

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const { data, error } = await supabaseAdmin
    .from("inventory_forecast")
    .select("as_of, created_at, payload")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.error("production/forecast: fetch failed", { error: error.message });
    return NextResponse.json({ error: "Fetch failed" }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ snapshot: null });
  }

  return NextResponse.json({
    snapshot: data.payload,
    as_of: data.as_of,
    created_at: data.created_at,
  });
}
