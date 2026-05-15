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
 * PATCH /api/hr/leave-requests/[id] — cancel a previously submitted request.
 *
 * Workers can cancel their own (RLS already enforces this); admin/manager
 * can cancel any. Cancelling also deletes the linked future hr_day_events
 * so the schedule no longer shows the absence. Past events stay — we don't
 * rewrite history.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getUserContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let body: { action: "cancel" };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (body.action !== "cancel") {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  try {
    const supabase = getSupabase(req);
    const { data: existing, error: loadErr } = await supabase
      .from("hr_leave_requests")
      .select("id, user_id, organization_id, start_date, working_days, leave_type, status")
      .eq("id", id)
      .maybeSingle();

    if (loadErr) throw loadErr;
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing.user_id !== ctx.userId && !isManagerOrAdmin(ctx.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (existing.status !== "submitted") {
      return NextResponse.json({ error: "Already cancelled" }, { status: 400 });
    }

    const { error: updErr } = await supabase
      .from("hr_leave_requests")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", id);
    if (updErr) throw updErr;

    // Remove future hr_day_events that fall on or after today. Past events
    // remain as a historical record of the absence.
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const eventType = existing.leave_type === "paid" ? "paid_leave" : "unpaid_leave";
    await supabase
      .from("hr_day_events")
      .delete()
      .eq("user_id", existing.user_id)
      .eq("event_type", eventType)
      .gte("event_date", todayIso);

    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("HR leave-requests PATCH failed", { ...requestMeta(req), error: String(err) });
    return NextResponse.json({ error: "Failed to cancel" }, { status: 500 });
  }
}
