import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getMetaBudget, updateMetaBudget } from "@/lib/meta";
import { logger } from "@/lib/logger";

// ============================================================
// POST /api/dashboard/action/scale
//
// Body: { briefId, targetType: "adset"|"campaign", targetId,
//         integrationAccountId, factor: 1.25 | 1.5 | 2.0 }
//
// Flow:
//   1. Whitelist factor.
//   2. Load brief row; verify target + account match and status='pending'.
//   3. GET current daily_budget from Meta (integer cents).
//   4. Compute new = round(current * factor), POST to Meta.
//   5. Flip agent_briefs.status to 'actioned'.
// ============================================================

interface ScaleBody {
  briefId?: string;
  targetType?: "ad" | "adset" | "campaign";
  targetId?: string;
  integrationAccountId?: string;
  factor?: number;
}

// Server-side whitelist — clients may NOT send arbitrary factors. The UI
// renders three preset buttons, so these are the only legitimate values.
const ALLOWED_FACTORS = new Set([1.25, 1.5, 2.0]);

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  let body: ScaleBody;
  try {
    body = (await req.json()) as ScaleBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { briefId, targetType, targetId, integrationAccountId, factor } = body;
  if (!briefId || !targetType || !targetId || !integrationAccountId || factor == null) {
    return NextResponse.json(
      { error: "briefId, targetType, targetId, integrationAccountId, factor required" },
      { status: 400 }
    );
  }

  if (!ALLOWED_FACTORS.has(factor)) {
    return NextResponse.json(
      { error: "factor must be 1.25, 1.5, or 2.0" },
      { status: 400 }
    );
  }

  if (targetType !== "adset" && targetType !== "campaign") {
    return NextResponse.json(
      { error: "scale applies only to adset or campaign" },
      { status: 400 }
    );
  }

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

  // Fetch current budget from Meta. Returns null for lifetime-budget
  // campaigns — we refuse to scale those (shouldn't end up as candidates
  // anyway, but defence in depth).
  const current = await getMetaBudget(targetId, targetType, integrationAccountId);
  if (!current) {
    return NextResponse.json(
      { error: "Could not read current budget from Meta" },
      { status: 502 }
    );
  }
  if (current.dailyBudgetCents == null) {
    return NextResponse.json(
      { error: "Object has no daily budget (lifetime budget?)" },
      { status: 400 }
    );
  }

  const newCents = Math.round(current.dailyBudgetCents * factor);
  if (!Number.isInteger(newCents) || newCents <= 0) {
    logger.error("action/scale: computed budget invalid", {
      briefId,
      current: current.dailyBudgetCents,
      factor,
      newCents,
    });
    return NextResponse.json({ error: "Invalid computed budget" }, { status: 500 });
  }

  const ok = await updateMetaBudget(targetId, targetType, newCents, integrationAccountId);
  if (!ok) {
    return NextResponse.json({ error: "Meta rejected the request" }, { status: 502 });
  }

  const { error: updateErr } = await supabaseAdmin
    .from("agent_briefs")
    .update({ status: "actioned", actioned_at: new Date().toISOString() })
    .eq("id", briefId);

  if (updateErr) {
    logger.error("action/scale: agent_briefs update failed", {
      briefId,
      error: updateErr.message,
    });
    return NextResponse.json({
      ok: true,
      warning: "brief status not updated",
      previousCents: current.dailyBudgetCents,
      newCents,
    });
  }

  return NextResponse.json({
    ok: true,
    previousCents: current.dailyBudgetCents,
    newCents,
    factor,
  });
}
