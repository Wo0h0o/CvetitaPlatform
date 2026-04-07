import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { createServerClient } from "@supabase/ssr";
import { scanCompetitor } from "@/lib/competitor-scanner";
import { logger, requestMeta } from "@/lib/logger";

export const maxDuration = 120;

function getSupabase(req: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return req.cookies.getAll(); }, setAll() {} } }
  );
}

// POST /api/competitors/scan — AI-powered product scan
export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const { competitorId } = await req.json();
    if (!competitorId) {
      return NextResponse.json({ error: "competitorId required" }, { status: 400 });
    }

    const supabase = getSupabase(req);

    // Get competitor
    const { data: comp, error: compErr } = await supabase
      .from("competitors")
      .select("*")
      .eq("id", competitorId)
      .single();

    if (compErr || !comp) {
      return NextResponse.json({ error: "Competitor not found" }, { status: 404 });
    }

    if (!comp.domain) {
      return NextResponse.json({ error: "Competitor has no domain set" }, { status: 400 });
    }

    // Run AI scan
    const result = await scanCompetitor(comp.domain, 30);

    // Save discovered products as prices
    if (result.products.length > 0) {
      // Clear old prices for this competitor (replace with fresh scan)
      await supabase
        .from("competitor_prices")
        .delete()
        .eq("competitor_id", competitorId);

      // Insert new prices
      const { error: insertErr } = await supabase
        .from("competitor_prices")
        .insert(
          result.products.map((p) => ({
            competitor_id: competitorId,
            product_name: p.name,
            product_url: p.url,
            price: p.price,
            currency: p.currency,
            in_stock: p.inStock,
          }))
        );

      if (insertErr) {
        logger.error("Failed to insert scanned prices", { error: String(insertErr) });
      }

      // Also save product URLs in competitor settings for future cron runs
      const productUrls = result.products.map((p) => p.url);
      await supabase
        .from("competitors")
        .update({ settings: { ...(comp.settings || {}), productUrls } })
        .eq("id", competitorId);
    }

    logger.info("Competitor scan complete", {
      competitor: comp.name,
      urlsFound: result.urlsFound,
      products: result.products.length,
    });

    return NextResponse.json({
      success: true,
      urlsFound: result.urlsFound,
      urlsScanned: result.urlsScanned,
      productsExtracted: result.products.length,
      products: result.products,
    });
  } catch (err) {
    logger.error("Competitor scan failed", { ...requestMeta(req), error: String(err) });
    return NextResponse.json({ error: "Scan failed: " + String(err) }, { status: 500 });
  }
}
