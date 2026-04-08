import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/api-auth";
import { createClient } from "@supabase/supabase-js";
import { scanCompetitor } from "@/lib/competitor-scanner";
import { searchCompetitorIntel } from "@/lib/competitor-scraper";
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
      // 1. Product scanning (sitemap discovery + price extraction)
      if (comp.domain) {
        try {
          const scanResult = await scanCompetitor(comp.domain, 20);
          if (scanResult.products.length > 0) {
            await supabase.from("competitor_prices").insert(
              scanResult.products.map((p) => ({
                competitor_id: comp.id,
                product_name: p.name,
                product_url: p.url,
                price: p.price,
                currency: p.currency,
                in_stock: p.inStock,
              }))
            );

            // Update stored URLs
            await supabase
              .from("competitors")
              .update({
                settings: {
                  ...(comp.settings || {}),
                  productUrls: scanResult.products.map((p) => p.url),
                  lastScanAt: new Date().toISOString(),
                },
              })
              .eq("id", comp.id);

            results.push(`${comp.name}: ${scanResult.products.length} prices scraped`);
          }
        } catch (scanErr) {
          logger.error("Cron scan failed for competitor", { name: comp.name, error: String(scanErr) });
          results.push(`${comp.name}: scan failed`);
        }
      }

      // 2. Intelligence search
      try {
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
      } catch (intelErr) {
        logger.error("Cron intel failed for competitor", { name: comp.name, error: String(intelErr) });
      }
    }

    logger.info("Competitor scrape complete", { results });
    return NextResponse.json({ success: true, results });
  } catch (err) {
    logger.error("Competitor scrape cron failed", { error: String(err) });
    return NextResponse.json({ error: "Scrape failed" }, { status: 500 });
  }
}
