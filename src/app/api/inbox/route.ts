import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/inbox
 *
 * Returns the inbox feed: pending + acknowledged cards, ordered by severity
 * weight then created_at desc. Snoozed cards are hidden unless ?showSnoozed=1.
 *
 * Query params:
 *   - market           filter to a single market_code
 *   - severity         comma-separated subset of (red,amber,green,info)
 *   - status           comma-separated subset of (pending,actioned,dismissed,acknowledged)
 *   - source_agent     filter by producer
 *   - showSnoozed=1    include cards whose snoozed_until is in the future
 *   - countOnly=1      return only { count } for the sidebar badge
 *   - limit            default 100, max 500
 */
export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const url = new URL(req.url);
  const market = url.searchParams.get("market");
  const severityParam = url.searchParams.get("severity");
  const statusParam = url.searchParams.get("status");
  const sourceAgent = url.searchParams.get("source_agent");
  const showSnoozed = url.searchParams.get("showSnoozed") === "1";
  const countOnly = url.searchParams.get("countOnly") === "1";
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10), 500);

  // For the sidebar badge: a single COUNT query is much cheaper than fetching
  // every row just to count it.
  if (countOnly) {
    let q = supabaseAdmin
      .from("agent_briefs")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    if (!showSnoozed) {
      q = q.or(`snoozed_until.is.null,snoozed_until.lte.${new Date().toISOString()}`);
    }
    const { count, error } = await q;
    if (error) {
      logger.error("inbox count failed", { error: error.message });
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
    return NextResponse.json({ count: count ?? 0 });
  }

  let query = supabaseAdmin
    .from("agent_briefs")
    .select(
      "id, organization_id, integration_account_id, store_id, source_agent, " +
        "for_date, severity, title, why, target_type, target_id, target_name, " +
        "actions, status, snoozed_until, assigned_to, " +
        "outcome_status, outcome_metric, outcome_baseline_value, outcome_current_value, " +
        "outcome_revisit_at, outcome_summary, outcome_evaluated_at, " +
        "actioned_at, created_at, " +
        "stores ( market_code, name )"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (statusParam) {
    const statuses = statusParam.split(",").map((s) => s.trim());
    query = query.in("status", statuses);
  } else {
    // Default to active inbox: pending + acknowledged. Dismissed/actioned
    // live in a separate archive view callers must opt into.
    query = query.in("status", ["pending", "acknowledged"]);
  }

  if (severityParam) {
    const severities = severityParam.split(",").map((s) => s.trim());
    query = query.in("severity", severities);
  }

  if (sourceAgent) query = query.eq("source_agent", sourceAgent);

  if (market) {
    // Filter by joined store.market_code via inner join is awkward in the
    // PostgREST DSL — pull store ids matching the market and use IN.
    const { data: storeMatch } = await supabaseAdmin
      .from("stores")
      .select("id")
      .eq("market_code", market);
    const storeIds = (storeMatch ?? []).map((s) => s.id as string);
    if (storeIds.length === 0) {
      return NextResponse.json({ cards: [], total: 0 });
    }
    query = query.in("store_id", storeIds);
  }

  if (!showSnoozed) {
    query = query.or(
      `snoozed_until.is.null,snoozed_until.lte.${new Date().toISOString()}`
    );
  }

  const { data, error } = await query;
  if (error) {
    logger.error("inbox fetch failed", { error: error.message });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  return NextResponse.json({ cards: data ?? [], total: data?.length ?? 0 });
}
