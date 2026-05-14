import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/inbox/[id]
 *
 * Body: { action: 'approve' | 'dismiss' | 'snooze' | 'acknowledge', snoozeHours?: number }
 *
 * Notes:
 *   - 'approve' marks the card as actioned + sets outcome_status='measuring'
 *     so the revisit cron will evaluate it. It does NOT execute any external
 *     action (Meta pause, etc.) — that's Layer 3 work; for now approve means
 *     "I'm acting on this, please track the outcome".
 *   - 'dismiss' marks the card actioned but outcome_status='na' (we won't
 *     measure something the user explicitly rejected).
 *   - 'snooze' leaves status='pending' and sets snoozed_until=now+hours.
 *   - 'acknowledge' marks the card seen without acting — for informational
 *     cards that don't have a real action.
 */

interface ActionBody {
  action: "approve" | "dismiss" | "snooze" | "acknowledge";
  snoozeHours?: number;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const { id } = await params;
  let body: ActionBody;
  try {
    body = (await req.json()) as ActionBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.action) {
    return NextResponse.json({ error: "Missing action" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const update: Record<string, unknown> = {};

  switch (body.action) {
    case "approve":
      update.status = "actioned";
      update.actioned_at = now;
      update.outcome_status = "measuring";
      break;
    case "dismiss":
      update.status = "dismissed";
      update.actioned_at = now;
      update.outcome_status = "na";
      break;
    case "acknowledge":
      update.status = "acknowledged";
      update.actioned_at = now;
      break;
    case "snooze": {
      const hours = Math.max(1, Math.min(body.snoozeHours ?? 24, 24 * 30));
      const until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
      update.snoozed_until = until;
      // status stays "pending" — snoozed cards re-enter the feed once
      // snoozed_until passes.
      break;
    }
    default:
      return NextResponse.json(
        { error: `Unknown action: ${body.action}` },
        { status: 400 }
      );
  }

  const { data, error } = await supabaseAdmin
    .from("agent_briefs")
    .update(update)
    .eq("id", id)
    .select("id, status, snoozed_until, outcome_status, actioned_at")
    .single();

  if (error) {
    logger.error("inbox action failed", { id, action: body.action, error: error.message });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, card: data });
}
