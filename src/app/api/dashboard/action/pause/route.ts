import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { updateMetaAdStatus, updateMetaAdSetStatus } from "@/lib/meta";
import { logger } from "@/lib/logger";

// ============================================================
// POST /api/dashboard/action/pause
//
// Body: { briefId: string, targetType: "ad"|"adset"|"campaign",
//         targetId: string, integrationAccountId: string }
//
// Flow:
//   1. Load the brief row and verify targetId/integrationAccountId match.
//   2. Call Meta to pause the ad or adset (campaign-level pause rejected).
//   3. Flip agent_briefs.status to 'actioned', stamp actioned_at.
// ============================================================

interface PauseBody {
  briefId?: string;
  targetType?: "ad" | "adset" | "campaign";
  targetId?: string;
  integrationAccountId?: string;
}

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  let body: PauseBody;
  try {
    body = (await req.json()) as PauseBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { briefId, targetType, targetId, integrationAccountId } = body;
  if (!briefId || !targetType || !targetId || !integrationAccountId) {
    return NextResponse.json(
      { error: "briefId, targetType, targetId, integrationAccountId required" },
      { status: 400 }
    );
  }

  if (targetType === "campaign") {
    return NextResponse.json(
      { error: "campaign-level pause is out of W4 scope" },
      { status: 405 }
    );
  }

  // Brief-row consistency check — also serves as an implicit authz guard:
  // clients can't flip arbitrary agent_briefs rows without knowing an
  // existing row's {id, target_id, integration_account_id} tuple.
  const { data: brief, error: briefErr } = await supabaseAdmin
    .from("agent_briefs")
    .select("id, target_type, target_id, integration_account_id, status")
    .eq("id", briefId)
    .maybeSingle();

  if (briefErr || !brief) {
    return NextResponse.json({ error: "Brief not found" }, { status: 404 });
  }
  if (
    brief.target_type !== targetType ||
    brief.target_id !== targetId ||
    brief.integration_account_id !== integrationAccountId
  ) {
    return NextResponse.json({ error: "Brief target mismatch" }, { status: 403 });
  }
  if (brief.status !== "pending") {
    return NextResponse.json({ error: "Brief already actioned" }, { status: 409 });
  }

  const ok =
    targetType === "ad"
      ? await updateMetaAdStatus(targetId, "PAUSED", integrationAccountId)
      : await updateMetaAdSetStatus(targetId, "PAUSED", integrationAccountId);

  if (!ok) {
    logger.error("action/pause: Meta rejected the request", {
      briefId,
      targetType,
      targetId,
    });
    return NextResponse.json({ error: "Meta rejected the request" }, { status: 502 });
  }

  const { error: updateErr } = await supabaseAdmin
    .from("agent_briefs")
    .update({ status: "actioned", actioned_at: new Date().toISOString() })
    .eq("id", briefId);

  if (updateErr) {
    logger.error("action/pause: agent_briefs update failed", {
      briefId,
      error: updateErr.message,
    });
    // Meta already paused — don't unwind. Just surface the DB error; the
    // next cron run will see the pause reflected in insights but will not
    // re-surface this card because the target is no longer active.
    return NextResponse.json({ ok: true, warning: "brief status not updated" });
  }

  return NextResponse.json({ ok: true });
}
