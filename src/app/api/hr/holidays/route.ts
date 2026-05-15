import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getUserContext, isManagerOrAdmin } from "@/lib/user-role";
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
 * GET /api/hr/holidays?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * List org holidays in a date range. Every role can read — workers need
 * the list to render the right tiles in /hr/schedule.
 */
export async function GET(req: NextRequest) {
  const ctx = await getUserContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");

  try {
    const supabase = getSupabase(req);
    let q = supabase
      .from("hr_holidays")
      .select("organization_id, holiday_date, label, is_official, is_compensation")
      .eq("organization_id", ctx.organizationId)
      .order("holiday_date", { ascending: true });

    if (from) q = q.gte("holiday_date", from);
    if (to) q = q.lte("holiday_date", to);

    const { data, error } = await q;
    if (error) throw error;

    return NextResponse.json({ holidays: data ?? [] });
  } catch (err) {
    logger.error("HR holidays GET failed", { ...requestMeta(req), error: String(err) });
    return NextResponse.json({ error: "Failed to load holidays" }, { status: 500 });
  }
}

interface AddBody {
  holiday_date: string;
  label: string;
}

/**
 * POST /api/hr/holidays — add a custom company day (e.g. team outing).
 * Manager+admin only.
 */
export async function POST(req: NextRequest) {
  const ctx = await getUserContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isManagerOrAdmin(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: AddBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.holiday_date || !/^\d{4}-\d{2}-\d{2}$/.test(body.holiday_date)) {
    return NextResponse.json({ error: "holiday_date must be YYYY-MM-DD" }, { status: 400 });
  }
  if (!body.label?.trim()) {
    return NextResponse.json({ error: "label is required" }, { status: 400 });
  }

  try {
    const supabase = getSupabase(req);
    const { data, error } = await supabase
      .from("hr_holidays")
      .upsert(
        {
          organization_id: ctx.organizationId,
          holiday_date: body.holiday_date,
          label: body.label.trim(),
          is_official: false,
          is_compensation: false,
        },
        { onConflict: "organization_id,holiday_date" }
      )
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ holiday: data });
  } catch (err) {
    logger.error("HR holidays POST failed", { ...requestMeta(req), error: String(err) });
    return NextResponse.json({ error: "Failed to save holiday" }, { status: 500 });
  }
}

/**
 * DELETE /api/hr/holidays?date=YYYY-MM-DD — remove one. Manager+admin only.
 */
export async function DELETE(req: NextRequest) {
  const ctx = await getUserContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isManagerOrAdmin(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const date = req.nextUrl.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  try {
    const supabase = getSupabase(req);
    const { error } = await supabase
      .from("hr_holidays")
      .delete()
      .eq("organization_id", ctx.organizationId)
      .eq("holiday_date", date);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("HR holidays DELETE failed", { ...requestMeta(req), error: String(err) });
    return NextResponse.json({ error: "Failed to delete holiday" }, { status: 500 });
  }
}
