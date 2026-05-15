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

async function loadEvent(req: NextRequest, id: number) {
  const supabase = getSupabase(req);
  const { data, error } = await supabase
    .from("hr_day_events")
    .select("id, user_id, organization_id, event_type")
    .eq("id", id)
    .maybeSingle();
  return { data, error, supabase };
}

/**
 * PATCH /api/hr/day-events/[id] — edit start/end/reason on an existing event.
 * Type changes are intentionally not supported here: deleting + recreating
 * keeps the audit trail cleaner and avoids juggling CHECK constraints.
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

  const { data: existing, error: loadErr, supabase } = await loadEvent(req, id);
  if (loadErr) {
    logger.error("HR day-events PATCH load failed", { ...requestMeta(req), error: String(loadErr) });
    return NextResponse.json({ error: "Failed to load event" }, { status: 500 });
  }
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.user_id !== ctx.userId && !isManagerOrAdmin(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { start_time?: string | null; end_time?: string | null; reason?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Full-day-off events have no time range — refuse silently to set one.
  const isFullDay = ["sick", "paid_leave", "unpaid_leave"].includes(existing.event_type);
  if (isFullDay && (body.start_time || body.end_time)) {
    return NextResponse.json({ error: "Full-day events cannot have a time range" }, { status: 400 });
  }
  if (
    !isFullDay &&
    body.start_time &&
    body.end_time &&
    body.end_time <= body.start_time
  ) {
    return NextResponse.json({ error: "end_time must be after start_time" }, { status: 400 });
  }

  try {
    const { data, error } = await supabase
      .from("hr_day_events")
      .update({
        start_time: body.start_time ?? null,
        end_time: body.end_time ?? null,
        reason: body.reason ?? null,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ event: data });
  } catch (err) {
    logger.error("HR day-events PATCH failed", { ...requestMeta(req), error: String(err) });
    return NextResponse.json({ error: "Failed to update event" }, { status: 500 });
  }
}

export async function DELETE(
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

  const { data: existing, error: loadErr, supabase } = await loadEvent(req, id);
  if (loadErr) {
    logger.error("HR day-events DELETE load failed", { ...requestMeta(req), error: String(loadErr) });
    return NextResponse.json({ error: "Failed to load event" }, { status: 500 });
  }
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.user_id !== ctx.userId && !isManagerOrAdmin(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { error } = await supabase.from("hr_day_events").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("HR day-events DELETE failed", { ...requestMeta(req), error: String(err) });
    return NextResponse.json({ error: "Failed to delete event" }, { status: 500 });
  }
}
