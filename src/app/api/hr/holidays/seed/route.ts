import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getUserContext, isManagerOrAdmin } from "@/lib/user-role";
import { bulgarianHolidays } from "@/lib/bg-holidays";
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
 * POST /api/hr/holidays/seed?year=YYYY
 *
 * Idempotently upserts the BG state-mandated holiday calendar for `year`.
 * Manager+admin only. Returns the seeded list. Custom company-added rows
 * (is_official=false) are left untouched even if they collide on date.
 */
export async function POST(req: NextRequest) {
  const ctx = await getUserContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isManagerOrAdmin(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const yearStr = req.nextUrl.searchParams.get("year");
  const year = Number(yearStr);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    return NextResponse.json({ error: "year query param required (1900–2100)" }, { status: 400 });
  }

  try {
    const supabase = getSupabase(req);
    const rows = bulgarianHolidays(year).map((h) => ({
      organization_id: ctx.organizationId,
      holiday_date: h.date,
      label: h.label,
      is_official: true,
      is_compensation: h.isCompensation,
    }));

    // Upsert by (org, date). For dates already present as is_official=false
    // (custom company entries), we INTENTIONALLY do NOT overwrite — the
    // admin's hand-edited label wins. Achieved via ON CONFLICT ... WHERE.
    // PostgREST's upsert doesn't support partial-match WHERE, so we fetch
    // the official-vs-custom split and only upsert the official slots.
    const { data: existing } = await supabase
      .from("hr_holidays")
      .select("holiday_date, is_official")
      .eq("organization_id", ctx.organizationId)
      .gte("holiday_date", `${year}-01-01`)
      .lte("holiday_date", `${year}-12-31`);
    const customDates = new Set(
      (existing ?? [])
        .filter((r) => !r.is_official)
        .map((r) => r.holiday_date as string)
    );
    const toUpsert = rows.filter((r) => !customDates.has(r.holiday_date));

    const { data, error } = await supabase
      .from("hr_holidays")
      .upsert(toUpsert, { onConflict: "organization_id,holiday_date" })
      .select();

    if (error) throw error;
    return NextResponse.json({
      year,
      seeded: data?.length ?? 0,
      skipped_custom: customDates.size,
      holidays: data,
    });
  } catch (err) {
    logger.error("HR holidays seed failed", { ...requestMeta(req), error: String(err) });
    return NextResponse.json({ error: "Failed to seed holidays" }, { status: 500 });
  }
}
