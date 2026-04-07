import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/api-auth";
import { createClient } from "@supabase/supabase-js";
import {
  scrapeProductPrices,
  fetchMetaAdLibrary,
  searchCompetitorIntel,
} from "@/lib/competitor-scraper";
import { logger } from "@/lib/logger";

// Use service role for cron — no user session
function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export const maxDuration = 60;

// GET /api/cron/competitor-scrape — daily competitor data collection
export async function GET(req: NextRequest) {
  const cronError = requireCronSecret(req);
  if (cronError) return cronError;

  const supabase = getAdminSupabase();
  const results: string[] = [];

  try {
    // Fetch all active competitors
    const { data: competitors, error } = await supabase
      .from("competitors")
      .select("*")
      .eq("is_active", true);

    if (error) throw error;
    if (!competitors?.length) {
      return NextResponse.json({ message: "No active competitors" });
    }

    for (const comp of competitors) {
      // 1. Price scraping
      const productUrls = (comp.settings?.productUrls as string[]) || [];
      if (productUrls.length > 0) {
        const prices = await scrapeProductPrices(comp.domain || "", productUrls);
        if (prices.length > 0) {
          await supabase.from("competitor_prices").insert(
            prices.map((p) => ({
              competitor_id: comp.id,
              product_name: p.productName,
              product_url: p.productUrl,
              price: p.price,
              currency: p.currency,
              in_stock: p.inStock,
            }))
          );
          results.push(`${comp.name}: ${prices.length} prices scraped`);
        }
      }

      // 2. Meta Ad Library
      if (comp.facebook_page) {
        const ads = await fetchMetaAdLibrary(comp.facebook_page);
        if (ads.length > 0) {
          await supabase.from("competitor_ads").insert(
            ads.map((a) => ({
              competitor_id: comp.id,
              platform: "meta",
              ad_id: a.adId,
              ad_text: a.adText,
              creative_url: a.creativeUrl,
              started_at: a.startedAt,
              is_active: a.isActive,
            }))
          );
          results.push(`${comp.name}: ${ads.length} ads found`);
        }
      }

      // 3. Intelligence search
      const intel = await searchCompetitorIntel(comp.name);
      if (intel.length > 0) {
        await supabase.from("competitor_intel").insert(
          intel.map((i) => ({
            competitor_id: comp.id,
            organization_id: comp.organization_id,
            source: i.source,
            title: i.title,
            summary: i.summary,
            url: i.url,
            sentiment: i.sentiment,
            relevance_score: i.relevanceScore,
          }))
        );
        results.push(`${comp.name}: ${intel.length} intel items`);
      }
    }

    logger.info("Competitor scrape complete", { results });
    return NextResponse.json({ success: true, results });
  } catch (err) {
    logger.error("Competitor scrape cron failed", { error: String(err) });
    return NextResponse.json({ error: "Scrape failed" }, { status: 500 });
  }
}
