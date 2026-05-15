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

const FULL_DAY_TYPES = new Set(["sick", "paid_leave", "unpaid_leave"]);
const PARTIAL_TYPES = new Set(["absence", "overtime"]);
const ALL_TYPES = new Set([...FULL_DAY_TYPES, ...PARTIAL_TYPES]);

/**
 * GET /api/hr/day-events?from=YYYY-MM-DD&to=YYYY-MM-DD[&userId=UUID]
 *
 * Range fetch used by the schedule grid. `userId` defaults to self; a
 * manager/admin may pass any worker's id, or 'all' to get the whole org
 * (joined with profile name so the grid can group rows by worker).
 */
export async function GET(req: NextRequest) {
  const ctx = await getUserContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  const userIdParam = req.nextUrl.searchParams.get("userId");
  if (!from || !to) {
    return NextResponse.json({ error: "from and to required (YYYY-MM-DD)" }, { status: 400 });
  }

  const wantAll = userIdParam === "all";
  const targetUserId = userIdParam && !wantAll ? userIdParam : ctx.userId;
  const isCrossUser = wantAll || targetUserId !== ctx.userId;
  if (isCrossUser && !isManagerOrAdmin(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const supabase = getSupabase(req);
    let q = supabase
      .from("hr_day_events")
      .select(
        "id, user_id, organization_id, event_date, event_type, start_time, end_time, reason, created_by, created_at, updated_at"
      )
      .eq("organization_id", ctx.organizationId)
      .gte("event_date", from)
      .lte("event_date", to)
      .order("event_date", { ascending: true });

    if (!wantAll) q = q.eq("user_id", targetUserId);

    const { data, error } = await q;
    if (error) throw error;

    return NextResponse.json({ events: data ?? [] });
  } catch (err) {
    logger.error("HR day-events GET failed", { ...requestMeta(req), error: String(err) });
    return NextResponse.json({ error: "Failed to load events" }, { status: 500 });
  }
}

interface DayEventBody {
  userId?: string;          // target worker (defaults to self)
  event_date: string;       // YYYY-MM-DD — start of range (or single day)
  end_date?: string | null; // YYYY-MM-DD — inclusive end; full-day types only
  event_type: string;
  start_time?: string | null;
  end_time?: string | null;
  reason?: string | null;
}

/**
 * POST /api/hr/day-events — create event(s) for self or, with privileges, for
 * another worker.
 *
 * For full-day types (sick / paid_leave / unpaid_leave) the caller may pass
 * `end_date` to mark a range. We expand the range into one row per calendar
 * day (weekends included, so the calendar visually spans the whole leave
 * block). Partial types (absence / overtime) must remain single-day —
 * stretching a partial event across days has no meaningful interpretation.
 */
export async function POST(req: NextRequest) {
  const ctx = await getUserContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: DayEventBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const targetUserId = body.userId ?? ctx.userId;
  if (targetUserId !== ctx.userId && !isManagerOrAdmin(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!body.event_date || !/^\d{4}-\d{2}-\d{2}$/.test(body.event_date)) {
    return NextResponse.json({ error: "event_date must be YYYY-MM-DD" }, { status: 400 });
  }
  if (!ALL_TYPES.has(body.event_type)) {
    return NextResponse.json({ error: "Invalid event_type" }, { status: 400 });
  }

  const isFullDay = FULL_DAY_TYPES.has(body.event_type);
  if (isFullDay && (body.start_time || body.end_time)) {
    return NextResponse.json(
      { error: "Full-day events cannot have a time range" },
      { status: 400 }
    );
  }
  if (!isFullDay && (!body.start_time || !body.end_time)) {
    return NextResponse.json(
      { error: "Partial events require start_time and end_time" },
      { status: 400 }
    );
  }
  if (
    !isFullDay &&
    body.start_time &&
    body.end_time &&
    body.end_time <= body.start_time
  ) {
    return NextResponse.json(
      { error: "end_time must be after start_time" },
      { status: 400 }
    );
  }

  // Range expansion (full-day types only).
  if (!isFullDay && body.end_date && body.end_date !== body.event_date) {
    return NextResponse.json(
      { error: "end_date is only valid for full-day events" },
      { status: 400 }
    );
  }
  if (body.end_date && !/^\d{4}-\d{2}-\d{2}$/.test(body.end_date)) {
    return NextResponse.json({ error: "end_date must be YYYY-MM-DD" }, { status: 400 });
  }
  if (body.end_date && body.end_date < body.event_date) {
    return NextResponse.json(
      { error: "end_date must be on or after event_date" },
      { status: 400 }
    );
  }

  // Build the list of dates to insert.
  const dates: string[] = [];
  if (isFullDay && body.end_date) {
    const cur = new Date(body.event_date + "T00:00:00");
    const end = new Date(body.end_date + "T00:00:00");
    let safety = 366; // hard cap so a malformed range can't blow up the loop
    while (cur <= end && safety-- > 0) {
      const y = cur.getFullYear();
      const m = String(cur.getMonth() + 1).padStart(2, "0");
      const d = String(cur.getDate()).padStart(2, "0");
      dates.push(`${y}-${m}-${d}`);
      cur.setDate(cur.getDate() + 1);
    }
  } else {
    dates.push(body.event_date);
  }

  try {
    const supabase = getSupabase(req);
    const rows = dates.map((d) => ({
      user_id: targetUserId,
      organization_id: ctx.organizationId,
      event_date: d,
      event_type: body.event_type,
      start_time: isFullDay ? null : body.start_time,
      end_time: isFullDay ? null : body.end_time,
      reason: body.reason ?? null,
      created_by: ctx.userId,
    }));

    const { data, error } = await supabase
      .from("hr_day_events")
      .insert(rows)
      .select();

    if (error) throw error;
    // Single-day callers still get `event` for backwards compatibility.
    return NextResponse.json({ events: data, event: data?.[0] ?? null });
  } catch (err) {
    logger.error("HR day-events POST failed", { ...requestMeta(req), error: String(err) });
    return NextResponse.json({ error: "Failed to create event" }, { status: 500 });
  }
}
