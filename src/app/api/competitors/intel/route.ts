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

// GET /api/competitors/intel — latest intelligence feed
export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const supabase = getSupabase(req);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: member } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user!.id)
      .single();

    const { data: intel, error } = await supabase
      .from("competitor_intel")
      .select("*, competitors(name)")
      .eq("organization_id", member!.organization_id)
      .order("discovered_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    return NextResponse.json({ intel: intel || [] });
  } catch (err) {
    logger.error("Competitor intel GET failed", { ...requestMeta(req), error: String(err) });
    return NextResponse.json({ error: "Failed to load intel" }, { status: 500 });
  }
}
