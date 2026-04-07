import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { createServerClient } from "@supabase/ssr";
import { logger, requestMeta } from "@/lib/logger";

function getSupabase(req: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll() {},
      },
    }
  );
}

async function getOrgId(supabase: ReturnType<typeof getSupabase>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: member } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .single();

  return member?.organization_id || null;
}

// GET /api/settings — fetch org settings
export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const supabase = getSupabase(req);
    const orgId = await getOrgId(supabase);
    if (!orgId) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const { data: org, error } = await supabase
      .from("organizations")
      .select("name, settings")
      .eq("id", orgId)
      .single();

    if (error) throw error;

    return NextResponse.json({
      orgName: org.name,
      settings: org.settings || {},
    });
  } catch (err) {
    logger.error("Settings GET failed", { ...requestMeta(req), error: String(err) });
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

// PUT /api/settings — update org settings
export async function PUT(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const supabase = getSupabase(req);
    const orgId = await getOrgId(supabase);
    if (!orgId) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const body = await req.json();
    const { settings } = body;

    if (!settings || typeof settings !== "object") {
      return NextResponse.json({ error: "Invalid settings payload" }, { status: 400 });
    }

    // Merge with existing settings (partial update)
    const { data: current } = await supabase
      .from("organizations")
      .select("settings")
      .eq("id", orgId)
      .single();

    const merged = { ...(current?.settings || {}), ...settings };

    const { error } = await supabase
      .from("organizations")
      .update({ settings: merged })
      .eq("id", orgId);

    if (error) throw error;

    return NextResponse.json({ success: true, settings: merged });
  } catch (err) {
    logger.error("Settings PUT failed", { ...requestMeta(req), error: String(err) });
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}
