import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getUserContext, isManagerOrAdmin } from "@/lib/user-role";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  computeMonthlyTotals,
  monthRange,
  toIsoDate,
  type HrDayEvent,
} from "@/lib/hr";
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
 * GET /api/hr/team[?month=YYYY-MM]
 *
 * Returns every worker in the org joined with their HR profile and their
 * computed monthly totals (worked / expected / leave / sick / overtime).
 *
 * Manager/admin only. Workers fetching this endpoint get 403 — they have
 * their own /api/hr/profile + day-events endpoints for self data.
 *
 * Why admin client: organization_members.role doesn't expose a join to
 * auth.users via PostgREST without RLS gymnastics on auth.users. The admin
 * client lets us read auth.users.email cleanly for display purposes; all
 * authorization is enforced before the call.
 */
export async function GET(req: NextRequest) {
  const ctx = await getUserContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isManagerOrAdmin(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const monthParam = req.nextUrl.searchParams.get("month"); // YYYY-MM
  const ref = monthParam ? new Date(monthParam + "-01T00:00:00") : new Date();
  if (Number.isNaN(ref.getTime())) {
    return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  }
  const { start, end } = monthRange(ref);
  const startIso = toIsoDate(start);
  const endIso = toIsoDate(end);

  try {
    const supabase = getSupabase(req);

    // 1. All workers in this org. We restrict to role='worker' so the team
    //    page doesn't show the admin/manager themselves as employees.
    const { data: members, error: memberErr } = await supabase
      .from("organization_members")
      .select("user_id, role")
      .eq("organization_id", ctx.organizationId)
      .eq("role", "worker");
    if (memberErr) throw memberErr;
    const workerIds = (members ?? []).map((m) => m.user_id);

    if (workerIds.length === 0) {
      return NextResponse.json({ month: monthParam ?? toIsoDate(start).slice(0, 7), workers: [] });
    }

    // 2. HR profiles for those workers.
    const { data: profiles } = await supabase
      .from("hr_profiles")
      .select("user_id, full_name, job_title, employment_start")
      .in("user_id", workerIds);
    const profileByUser = new Map(
      (profiles ?? []).map((p) => [p.user_id as string, p])
    );

    // 3. Emails via admin client (auth.users isn't exposed via RLS).
    const emailByUser = new Map<string, string>();
    await Promise.all(
      workerIds.map(async (uid) => {
        const { data } = await supabaseAdmin.auth.admin.getUserById(uid);
        if (data?.user?.email) emailByUser.set(uid, data.user.email);
      })
    );

    // 4. Day events for this month, all workers in one query.
    const { data: events } = await supabase
      .from("hr_day_events")
      .select("id, user_id, event_date, event_type, start_time, end_time, reason")
      .eq("organization_id", ctx.organizationId)
      .gte("event_date", startIso)
      .lte("event_date", endIso)
      .in("user_id", workerIds);
    const eventsByUser = new Map<string, HrDayEvent[]>();
    for (const e of (events ?? []) as HrDayEvent[]) {
      const arr = eventsByUser.get(e.user_id) ?? [];
      arr.push(e);
      eventsByUser.set(e.user_id, arr);
    }

    // 4b. National holidays so the per-worker totals correctly drop
    // expected hours on праздници и не приписват base работа.
    const { data: holidays } = await supabase
      .from("hr_holidays")
      .select("holiday_date")
      .eq("organization_id", ctx.organizationId)
      .gte("holiday_date", startIso)
      .lte("holiday_date", endIso);
    const holidaySet = new Set((holidays ?? []).map((h) => h.holiday_date as string));

    // 5. Compose response.
    const workers = workerIds.map((uid) => {
      const profile = profileByUser.get(uid);
      const totals = computeMonthlyTotals(
        start,
        end,
        eventsByUser.get(uid) ?? [],
        holidaySet
      );
      return {
        user_id: uid,
        email: emailByUser.get(uid) ?? null,
        full_name: profile?.full_name ?? null,
        job_title: profile?.job_title ?? null,
        employment_start: profile?.employment_start ?? null,
        totals,
      };
    });

    // Sort by full_name (or email fallback) for stable rendering.
    workers.sort((a, b) =>
      (a.full_name ?? a.email ?? "").localeCompare(b.full_name ?? b.email ?? "", "bg")
    );

    return NextResponse.json({
      month: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
      workers,
    });
  } catch (err) {
    logger.error("HR team GET failed", { ...requestMeta(req), error: String(err) });
    return NextResponse.json({ error: "Failed to load team" }, { status: 500 });
  }
}
