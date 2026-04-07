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

// GET /api/competitors — list all competitors with latest prices
export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const supabase = getSupabase(req);
    const { data: competitors, error } = await supabase
      .from("competitors")
      .select("*")
      .eq("is_active", true)
      .order("name");

    if (error) throw error;

    // Fetch latest prices for each competitor
    const enriched = await Promise.all(
      (competitors || []).map(async (comp) => {
        const { data: prices } = await supabase
          .from("competitor_prices")
          .select("*")
          .eq("competitor_id", comp.id)
          .order("scraped_at", { ascending: false })
          .limit(20);

        const { data: ads } = await supabase
          .from("competitor_ads")
          .select("*")
          .eq("competitor_id", comp.id)
          .eq("is_active", true)
          .order("scraped_at", { ascending: false })
          .limit(5);

        return { ...comp, latestPrices: prices || [], activeAds: ads || [] };
      })
    );

    return NextResponse.json({ competitors: enriched });
  } catch (err) {
    logger.error("Competitors GET failed", { ...requestMeta(req), error: String(err) });
    return NextResponse.json({ error: "Failed to load competitors" }, { status: 500 });
  }
}

// POST /api/competitors — add a new competitor
export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const supabase = getSupabase(req);
    const body = await req.json();
    const { name, domain, facebookPage, category } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Get user's org
    const { data: { user } } = await supabase.auth.getUser();
    const { data: member } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user!.id)
      .single();

    const { data: competitor, error } = await supabase
      .from("competitors")
      .insert({
        organization_id: member!.organization_id,
        name,
        domain: domain || null,
        facebook_page: facebookPage || null,
        category: category || "direct",
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ competitor });
  } catch (err) {
    logger.error("Competitors POST failed", { ...requestMeta(req), error: String(err) });
    return NextResponse.json({ error: "Failed to add competitor" }, { status: 500 });
  }
}
