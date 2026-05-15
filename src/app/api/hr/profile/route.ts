import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getUserContext, isManagerOrAdmin } from "@/lib/user-role";
import { isValidEGN } from "@/lib/hr";
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

/**
 * GET /api/hr/profile             — own profile (any role)
 * GET /api/hr/profile?userId=UUID — another worker's profile (manager+admin only)
 *
 * The row may not exist yet (admin hasn't filled it). We return an empty
 * shape with the user_id pre-filled so the UI can render a blank form.
 */
export async function GET(req: NextRequest) {
  const ctx = await getUserContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const targetUserId = req.nextUrl.searchParams.get("userId") || ctx.userId;
  if (targetUserId !== ctx.userId && !isManagerOrAdmin(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const supabase = getSupabase(req);
    const { data, error } = await supabase
      .from("hr_profiles")
      .select(
        "user_id, organization_id, full_name, egn, city, address, job_title, employment_start, notes, created_at, updated_at"
      )
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (error) throw error;

    return NextResponse.json({
      profile:
        data ?? {
          user_id: targetUserId,
          organization_id: ctx.organizationId,
          full_name: "",
          egn: "",
          city: "",
          address: "",
          job_title: "",
          employment_start: null,
          notes: "",
        },
    });
  } catch (err) {
    logger.error("HR profile GET failed", { ...requestMeta(req), error: String(err) });
    return NextResponse.json({ error: "Failed to load profile" }, { status: 500 });
  }
}

interface ProfileBody {
  userId?: string;
  full_name?: string;
  egn?: string;
  city?: string;
  address?: string;
  job_title?: string;
  employment_start?: string | null;
  notes?: string;
}

/**
 * PUT /api/hr/profile — upsert. Body may include `userId` to target another
 * worker (manager+admin only). Workers can only edit their own row.
 *
 * Upsert is used so we don't need a separate POST when the admin invites a
 * worker — the row appears on first save.
 */
export async function PUT(req: NextRequest) {
  const ctx = await getUserContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: ProfileBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const targetUserId = body.userId ?? ctx.userId;
  if (targetUserId !== ctx.userId && !isManagerOrAdmin(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (body.egn && !isValidEGN(body.egn)) {
    return NextResponse.json({ error: "Невалиден ЕГН" }, { status: 400 });
  }

  try {
    const supabase = getSupabase(req);

    // Use upsert keyed on user_id (the PK). organization_id is required on
    // insert; on update it's a no-op but harmless to include.
    const { data, error } = await supabase
      .from("hr_profiles")
      .upsert(
        {
          user_id: targetUserId,
          organization_id: ctx.organizationId,
          full_name: body.full_name ?? null,
          egn: body.egn ?? null,
          city: body.city ?? null,
          address: body.address ?? null,
          job_title: body.job_title ?? null,
          employment_start: body.employment_start ?? null,
          notes: body.notes ?? null,
        },
        { onConflict: "user_id" }
      )
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ profile: data });
  } catch (err) {
    logger.error("HR profile PUT failed", { ...requestMeta(req), error: String(err) });
    return NextResponse.json({ error: "Failed to save profile" }, { status: 500 });
  }
}
