import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { createServerClient } from "@supabase/ssr";
import { logger, requestMeta } from "@/lib/logger";

function getSupabase(req: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return req.cookies.getAll(); }, setAll() {} } }
  );
}

interface CompetitorSettings {
  productUrls?: string[];
  lastScanAt?: string;
  lastScannedByUserId?: string;
  lastScanUrlsFound?: number;
  lastScanUrlsScanned?: number;
  lastScanProducts?: number;
  markets?: string[];
  sisterDomains?: string[];
}

// GET /api/competitors/[slug] — competitor detail + enriched scan summary
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const { slug } = await params;
    const supabase = getSupabase(req);

    const { data: comp, error } = await supabase
      .from("competitors")
      .select("*")
      .eq("slug", slug)
      .single();

    if (error || !comp) {
      return NextResponse.json({ error: "Competitor not found" }, { status: 404 });
    }

    // Latest prices (latest per product_url)
    const { data: prices } = await supabase
      .from("competitor_prices")
      .select("product_name, product_url, price, currency, in_stock, scraped_at")
      .eq("competitor_id", comp.id)
      .order("scraped_at", { ascending: false })
      .limit(200);

    // Dedup to latest-per-url, then filter to current-scan URLs only.
    // Without this filter, stale rows from earlier scans (when scanner had no
    // relevance filter / no dedup) keep showing up forever as "latest" because
    // they are append-only and never refreshed.
    const latestByUrl = new Map<string, NonNullable<typeof prices>[number]>();
    for (const p of prices || []) {
      if (p.product_url && !latestByUrl.has(p.product_url)) {
        latestByUrl.set(p.product_url, p);
      }
    }
    const settings = (comp.settings || {}) as CompetitorSettings;
    const currentScanUrls = new Set(settings.productUrls || []);
    const latestPrices = currentScanUrls.size > 0
      ? Array.from(latestByUrl.values()).filter((p) => currentScanUrls.has(p.product_url))
      : Array.from(latestByUrl.values());

    // Last scanner display name
    let lastScannedBy: { email: string | null } | null = null;
    if (settings.lastScannedByUserId) {
      const { data: scanner } = await supabase
        .from("organization_members")
        .select("user_id")
        .eq("user_id", settings.lastScannedByUserId)
        .single();
      if (scanner) {
        // We don't expose other users' emails — leave email null in v1.
        lastScannedBy = { email: null };
      }
    }

    // Counts
    const { count: alertsCount } = await supabase
      .from("competitor_alerts")
      .select("*", { count: "exact", head: true })
      .eq("competitor_id", comp.id)
      .eq("is_read", false);

    // Mapped count — only count mappings whose URL is in the current scan.
    // Orphan mappings (stale URL no longer scanned) are preserved in DB but
    // not counted in the badge so the UI stays consistent with what's visible.
    let mappedCount = 0;
    if (currentScanUrls.size > 0) {
      const { data: activeMappings } = await supabase
        .from("competitor_product_map")
        .select("competitor_product_url")
        .eq("competitor_id", comp.id)
        .in("competitor_product_url", Array.from(currentScanUrls));
      mappedCount = activeMappings?.length || 0;
    } else {
      const { count } = await supabase
        .from("competitor_product_map")
        .select("*", { count: "exact", head: true })
        .eq("competitor_id", comp.id);
      mappedCount = count || 0;
    }

    return NextResponse.json({
      competitor: {
        id: comp.id,
        slug: comp.slug,
        name: comp.name,
        domain: comp.domain,
        facebook_page: comp.facebook_page,
        category: comp.category,
        logo_url: comp.logo_url,
        markets: settings.markets || [],
        sisterDomains: settings.sisterDomains || [],
        seedUrls: Array.isArray(comp.seed_urls) ? comp.seed_urls : [],
        lastScanAt: settings.lastScanAt || null,
        lastScannedBy,
        lastScanUrlsFound: settings.lastScanUrlsFound ?? null,
        lastScanUrlsScanned: settings.lastScanUrlsScanned ?? null,
        lastScanProducts: settings.lastScanProducts ?? null,
        created_at: comp.created_at,
      },
      latestPrices,
      stats: {
        productsTracked: latestPrices.length,
        inStock: latestPrices.filter((p) => p.in_stock).length,
        unreadAlerts: alertsCount || 0,
        mappedProducts: mappedCount || 0,
      },
    });
  } catch (err) {
    logger.error("Competitor detail GET failed", { ...requestMeta(req), error: String(err) });
    return NextResponse.json({ error: "Failed to load competitor" }, { status: 500 });
  }
}

// PATCH /api/competitors/[slug] — admin-editable scan settings
// Body: { seedUrls?: string[] }
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const { slug } = await params;
    const supabase = getSupabase(req);
    const body = await req.json();

    const updates: Record<string, unknown> = {};

    if (Array.isArray(body.seedUrls)) {
      const cleaned: string[] = [];
      for (const raw of body.seedUrls) {
        if (typeof raw !== "string") continue;
        const trimmed = raw.trim();
        if (!trimmed) continue;
        try {
          const u = new URL(trimmed);
          if (u.protocol !== "https:" && u.protocol !== "http:") continue;
          cleaned.push(u.toString());
        } catch {
          // Skip invalid URL
        }
      }
      // Dedup while preserving order
      updates.seed_urls = [...new Set(cleaned)];
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const { data: updated, error } = await supabase
      .from("competitors")
      .update(updates)
      .eq("slug", slug)
      .select("id, slug, seed_urls")
      .single();

    if (error || !updated) {
      return NextResponse.json({ error: "Competitor not found or update blocked" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      seedUrls: updated.seed_urls || [],
    });
  } catch (err) {
    logger.error("Competitor PATCH failed", { ...requestMeta(req), error: String(err) });
    return NextResponse.json({ error: "Failed to update competitor" }, { status: 500 });
  }
}
