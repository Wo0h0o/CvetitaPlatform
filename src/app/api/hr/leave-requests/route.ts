import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getUserContext, isManagerOrAdmin } from "@/lib/user-role";
import { countWorkdays } from "@/lib/hr";
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
 * GET /api/hr/leave-requests[?userId=UUID|all]
 *   - default: own requests
 *   - userId=UUID: another worker (manager+admin only)
 *   - userId=all: every request in the org (manager+admin only)
 */
export async function GET(req: NextRequest) {
  const ctx = await getUserContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userIdParam = req.nextUrl.searchParams.get("userId");
  const wantAll = userIdParam === "all";
  const targetUserId = userIdParam && !wantAll ? userIdParam : ctx.userId;
  if ((wantAll || targetUserId !== ctx.userId) && !isManagerOrAdmin(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const supabase = getSupabase(req);
    let q = supabase
      .from("hr_leave_requests")
      .select(
        "id, user_id, organization_id, leave_type, start_date, working_days, reason, status, snapshot_full_name, snapshot_job_title, submitted_at, cancelled_at"
      )
      .eq("organization_id", ctx.organizationId)
      .order("submitted_at", { ascending: false });

    if (!wantAll) q = q.eq("user_id", targetUserId);

    const { data, error } = await q;
    if (error) throw error;
    return NextResponse.json({ requests: data ?? [] });
  } catch (err) {
    logger.error("HR leave-requests GET failed", { ...requestMeta(req), error: String(err) });
    return NextResponse.json({ error: "Failed to load requests" }, { status: 500 });
  }
}

interface SubmitBody {
  leave_type: "paid" | "unpaid";
  start_date: string;
  end_date?: string | null;
  working_days: number;
  reason?: string | null;
  /**
   * If true, also write hr_day_events of the matching type for every Mon–Fri
   * day in [start_date, start_date+working_days workdays]. Default true so the
   * schedule reflects the worker's planned absence immediately.
   */
  mark_in_schedule?: boolean;
}

/**
 * POST /api/hr/leave-requests — submit a paid/unpaid leave application.
 *
 * The worker's hr_profile must be filled (full_name + EGN + city + address +
 * job_title) — those values get frozen into the request row so a later
 * profile edit doesn't rewrite history. The PDF endpoint reads from these
 * snapshot columns, not from hr_profiles.
 */
export async function POST(req: NextRequest) {
  const ctx = await getUserContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: SubmitBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.leave_type !== "paid" && body.leave_type !== "unpaid") {
    return NextResponse.json({ error: "leave_type must be 'paid' or 'unpaid'" }, { status: 400 });
  }
  if (!body.start_date || !/^\d{4}-\d{2}-\d{2}$/.test(body.start_date)) {
    return NextResponse.json({ error: "start_date must be YYYY-MM-DD" }, { status: 400 });
  }
  if (body.end_date && !/^\d{4}-\d{2}-\d{2}$/.test(body.end_date)) {
    return NextResponse.json({ error: "end_date must be YYYY-MM-DD" }, { status: 400 });
  }
  if (body.end_date && body.end_date < body.start_date) {
    return NextResponse.json(
      { error: "end_date must be on or after start_date" },
      { status: 400 }
    );
  }
  const days = Number(body.working_days);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    return NextResponse.json({ error: "working_days must be 1..365" }, { status: 400 });
  }

  try {
    const supabase = getSupabase(req);

    const { data: profile } = await supabase
      .from("hr_profiles")
      .select("full_name, egn, city, address, job_title")
      .eq("user_id", ctx.userId)
      .maybeSingle();

    const missing = ["full_name", "egn", "city", "address", "job_title"].filter(
      (k) => !profile || !(profile as Record<string, string | null>)[k]
    );
    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: "Профилът ти не е попълнен",
          missing,
          message:
            "Попълни трите имена, ЕГН, град, адрес и длъжност в Настройки преди да подадеш заявка.",
        },
        { status: 400 }
      );
    }

    const { data: inserted, error } = await supabase
      .from("hr_leave_requests")
      .insert({
        user_id: ctx.userId,
        organization_id: ctx.organizationId,
        leave_type: body.leave_type,
        start_date: body.start_date,
        end_date: body.end_date ?? null,
        working_days: days,
        reason: body.reason ?? null,
        snapshot_full_name: profile!.full_name!,
        snapshot_egn: profile!.egn!,
        snapshot_city: profile!.city!,
        snapshot_address: profile!.address!,
        snapshot_job_title: profile!.job_title!,
      })
      .select()
      .single();

    if (error) throw error;

    // Mirror the leave into hr_day_events so the schedule shows the absence
    // right away. Skip dates that are already national holidays — the
    // holiday tile communicates "no work" on its own and we don't want
    // double bookkeeping.
    if (body.mark_in_schedule !== false) {
      const start = new Date(body.start_date + "T00:00:00");
      const eventType = body.leave_type === "paid" ? "paid_leave" : "unpaid_leave";

      // Pull the org's holidays from start_date through start + ~2 years
      // (covers the safety-loop horizon).
      const horizon = new Date(start);
      horizon.setDate(horizon.getDate() + 365 * 2);
      const horizonIso = `${horizon.getFullYear()}-${String(horizon.getMonth() + 1).padStart(2, "0")}-${String(horizon.getDate()).padStart(2, "0")}`;
      const { data: holidays } = await supabase
        .from("hr_holidays")
        .select("holiday_date")
        .eq("organization_id", ctx.organizationId)
        .gte("holiday_date", body.start_date)
        .lte("holiday_date", horizonIso);
      const holidaySet = new Set((holidays ?? []).map((h) => h.holiday_date as string));

      const dates: string[] = [];
      const cur = new Date(start);
      let remaining = days;
      let safety = 365 * 2;
      while (remaining > 0 && safety-- > 0) {
        const dow = cur.getDay();
        const iso = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
        if (dow >= 1 && dow <= 5 && !holidaySet.has(iso)) {
          dates.push(iso);
          remaining -= 1;
        }
        cur.setDate(cur.getDate() + 1);
      }

      if (dates.length > 0) {
        await supabase.from("hr_day_events").insert(
          dates.map((d) => ({
            user_id: ctx.userId,
            organization_id: ctx.organizationId,
            event_date: d,
            event_type: eventType,
            reason: body.reason ?? null,
            created_by: ctx.userId,
          }))
        );
      }

      void countWorkdays; // referenced for future use; keeps the import warm
    }

    return NextResponse.json({ request: inserted });
  } catch (err) {
    logger.error("HR leave-requests POST failed", { ...requestMeta(req), error: String(err) });
    return NextResponse.json({ error: "Failed to submit request" }, { status: 500 });
  }
}
