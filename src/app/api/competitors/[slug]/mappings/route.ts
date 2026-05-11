import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { createServerClient } from "@supabase/ssr";
import { fetchProductCatalog } from "@/lib/shopify";
import { logger, requestMeta } from "@/lib/logger";

function getSupabase(req: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return req.cookies.getAll(); }, setAll() {} } }
  );
}

async function resolveCompetitor(req: NextRequest, slug: string) {
  const supabase = getSupabase(req);
  const { data: comp } = await supabase
    .from("competitors")
    .select("id, organization_id")
    .eq("slug", slug)
    .single();
  return comp;
}

// GET /api/competitors/[slug]/mappings — list mappings with live Shopify prices + diff
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const { slug } = await params;
    const supabase = getSupabase(req);

    const comp = await resolveCompetitor(req, slug);
    if (!comp) {
      return NextResponse.json({ error: "Competitor not found" }, { status: 404 });
    }

    // Load mappings
    const { data: mappings, error } = await supabase
      .from("competitor_product_map")
      .select("*")
      .eq("competitor_id", comp.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    if (!mappings || mappings.length === 0) {
      return NextResponse.json({ mappings: [] });
    }

    // Live Shopify catalog (5-min cached)
    const catalog = await fetchProductCatalog();
    const shopifyById = new Map(catalog.map((p) => [String(p.id), p]));

    // Latest competitor price per URL
    const urls = mappings.map((m) => m.competitor_product_url);
    const { data: prices } = await supabase
      .from("competitor_prices")
      .select("product_url, price, currency, scraped_at")
      .eq("competitor_id", comp.id)
      .in("product_url", urls)
      .order("scraped_at", { ascending: false });

    const latestPrice = new Map<string, { price: number; currency: string; scraped_at: string }>();
    for (const p of prices || []) {
      if (p.product_url && !latestPrice.has(p.product_url)) {
        latestPrice.set(p.product_url, {
          price: Number(p.price),
          currency: p.currency,
          scraped_at: p.scraped_at,
        });
      }
    }

    const enriched = mappings.map((m) => {
      const shopify = shopifyById.get(m.our_shopify_product_id);
      const competitorPrice = latestPrice.get(m.competitor_product_url);
      const ourPrice = shopify?.variants?.[0]?.price ? Number(shopify.variants[0].price) : null;
      const compPrice = competitorPrice?.price ?? null;
      let diffPct: number | null = null;
      if (ourPrice && compPrice && compPrice > 0) {
        diffPct = ((ourPrice - compPrice) / compPrice) * 100;
      }
      return {
        id: m.id,
        competitorProductUrl: m.competitor_product_url,
        competitorProductName: m.competitor_product_name,
        competitorPrice: compPrice,
        competitorCurrency: competitorPrice?.currency || null,
        competitorScrapedAt: competitorPrice?.scraped_at || null,
        ourShopifyProductId: m.our_shopify_product_id,
        ourHandle: m.our_handle,
        ourProductName: shopify?.title || m.our_product_name,
        ourPrice,
        ourCurrency: "EUR",
        diffPct,
        mappingConfidence: m.mapping_confidence,
        ourActive: !!shopify, // false if Shopify product deleted/inactive
        createdAt: m.created_at,
      };
    });

    return NextResponse.json({ mappings: enriched });
  } catch (err) {
    logger.error("Mappings GET failed", { ...requestMeta(req), error: String(err) });
    return NextResponse.json({ error: "Failed to load mappings" }, { status: 500 });
  }
}

// POST /api/competitors/[slug]/mappings — create or update a mapping
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const { slug } = await params;
    const body = await req.json();
    const {
      competitorProductUrl,
      competitorProductName,
      shopifyProductId,
      source,
      notes,
    } = body as {
      competitorProductUrl?: string;
      competitorProductName?: string;
      shopifyProductId?: string;
      source?: "manual" | "ai_suggested";
      notes?: string;
    };

    if (!competitorProductUrl || !competitorProductName || !shopifyProductId) {
      return NextResponse.json(
        { error: "competitorProductUrl, competitorProductName, shopifyProductId required" },
        { status: 400 }
      );
    }

    const supabase = getSupabase(req);
    const comp = await resolveCompetitor(req, slug);
    if (!comp) {
      return NextResponse.json({ error: "Competitor not found" }, { status: 404 });
    }

    // Validate Shopify product exists
    const catalog = await fetchProductCatalog();
    const shopify = catalog.find((p) => String(p.id) === shopifyProductId);
    if (!shopify) {
      return NextResponse.json(
        { error: "Shopify product not found or inactive" },
        { status: 400 }
      );
    }

    // Current user (for created_by)
    const { data: { user } } = await supabase.auth.getUser();

    const { data: upserted, error } = await supabase
      .from("competitor_product_map")
      .upsert(
        {
          organization_id: comp.organization_id,
          competitor_id: comp.id,
          competitor_product_url: competitorProductUrl,
          competitor_product_name: competitorProductName,
          our_shopify_product_id: shopifyProductId,
          our_handle: shopify.handle,
          our_product_name: shopify.title,
          mapping_confidence: source === "ai_suggested" ? "ai_suggested" : "manual",
          notes: notes || null,
          created_by: user?.id || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "competitor_id,competitor_product_url" }
      )
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ mapping: upserted });
  } catch (err) {
    logger.error("Mapping POST failed", { ...requestMeta(req), error: String(err) });
    return NextResponse.json({ error: "Failed to save mapping" }, { status: 500 });
  }
}
