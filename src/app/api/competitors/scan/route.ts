import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { createClient } from "@supabase/supabase-js";
import { scanCompetitor } from "@/lib/competitor-scanner";
import { logger, requestMeta } from "@/lib/logger";

export const maxDuration = 120;

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// POST /api/competitors/scan — product scan with price history + alerts
export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const { competitorId } = await req.json();
    if (!competitorId) {
      return NextResponse.json({ error: "competitorId required" }, { status: 400 });
    }

    const supabase = getAdminSupabase();

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

    // Get previous prices for comparison (latest per product_url)
    const { data: prevPrices } = await supabase
      .from("competitor_prices")
      .select("product_name, product_url, price, currency")
      .eq("competitor_id", competitorId)
      .order("scraped_at", { ascending: false });

    const prevMap = new Map<string, { price: number; name: string }>();
    if (prevPrices) {
      for (const p of prevPrices) {
        if (p.product_url && !prevMap.has(p.product_url)) {
          prevMap.set(p.product_url, { price: Number(p.price), name: p.product_name });
        }
      }
    }

    // Run scan
    const result = await scanCompetitor(comp.domain, 30);
    const alerts: { type: string; title: string; data: Record<string, unknown> }[] = [];

    if (result.products.length > 0) {
      // APPEND new prices (never delete old ones — we keep history)
      await supabase.from("competitor_prices").insert(
        result.products.map((p) => ({
          competitor_id: competitorId,
          product_name: p.name,
          product_url: p.url,
          price: p.price,
          currency: p.currency,
          in_stock: p.inStock,
        }))
      );

      // Generate alerts for price changes
      for (const product of result.products) {
        const prev = prevMap.get(product.url);
        if (!prev) continue;

        const pctChange = ((product.price - prev.price) / prev.price) * 100;

        if (Math.abs(pctChange) >= 3) {
          const type = pctChange < 0 ? "price_drop" : "price_increase";
          alerts.push({
            type,
            title: `${comp.name}: ${product.name} ${pctChange < 0 ? "↓" : "↑"} ${Math.abs(pctChange).toFixed(0)}%`,
            data: {
              productName: product.name,
              productUrl: product.url,
              oldPrice: prev.price,
              newPrice: product.price,
              currency: product.currency,
              pctChange: Number(pctChange.toFixed(1)),
            },
          });
        }
      }

      // Detect new products (URL not in previous scan)
      for (const product of result.products) {
        if (!prevMap.has(product.url) && prevPrices && prevPrices.length > 0) {
          alerts.push({
            type: "new_product",
            title: `${comp.name}: Нов продукт — ${product.name}`,
            data: {
              productName: product.name,
              productUrl: product.url,
              price: product.price,
              currency: product.currency,
            },
          });
        }
      }

      // Save alerts
      if (alerts.length > 0) {
        await supabase.from("competitor_alerts").insert(
          alerts.map((a) => ({
            organization_id: comp.organization_id,
            competitor_id: competitorId,
            type: a.type,
            title: a.title,
            data: a.data,
          }))
        );
      }

      // Update product URLs in settings
      const productUrls = result.products.map((p) => p.url);
      await supabase
        .from("competitors")
        .update({
          settings: { ...(comp.settings || {}), productUrls, lastScanAt: new Date().toISOString() },
        })
        .eq("id", competitorId);
    }

    return NextResponse.json({
      success: true,
      urlsFound: result.urlsFound,
      urlsScanned: result.urlsScanned,
      productsExtracted: result.products.length,
      alertsGenerated: alerts.length,
      products: result.products,
    });
  } catch (err) {
    logger.error("Competitor scan failed", { ...requestMeta(req), error: String(err) });
    return NextResponse.json({ error: "Scan failed: " + String(err) }, { status: 500 });
  }
}
