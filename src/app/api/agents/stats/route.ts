import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

const SCHEMA = "store_bg";
const WINDOW_DAYS = 30;

interface CallLogRow {
  agent_user_id: string | null;
  kind: "call" | "note";
  outcome: string | null;
  duration_seconds: number | null;
  follow_up_at: string | null;
  created_at: string;
}

interface AgentBucket {
  user_id: string;
  email: string | null;
  name: string;
  calls_today: number;
  calls_7d: number;
  calls_30d: number;
  notes_30d: number;
  outcomes: Record<string, number>;
  total_duration_seconds: number;
  calls_with_duration_30d: number;
  active_followups: number;
  upsells_30d: number;
  upsell_revenue_30d: number;
}

interface UpsellStatsRow {
  agent_user_id: string;
  upsells: number;
  upsell_revenue: number | string;
}

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const sinceISO = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayISO = todayStart.toISOString();
    const sevenDaysISO = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const futureCutoffISO = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

    const { data: rows, error } = await supabaseAdmin
      .schema(SCHEMA)
      .from("call_log")
      .select("agent_user_id, kind, outcome, duration_seconds, follow_up_at, created_at")
      .gte("created_at", sinceISO)
      .returns<CallLogRow[]>();

    if (error) throw error;

    const agents = new Map<string, AgentBucket>();

    const ensure = (id: string): AgentBucket => {
      let b = agents.get(id);
      if (!b) {
        b = {
          user_id: id,
          email: null,
          name: "—",
          calls_today: 0,
          calls_7d: 0,
          calls_30d: 0,
          notes_30d: 0,
          outcomes: {},
          total_duration_seconds: 0,
          calls_with_duration_30d: 0,
          active_followups: 0,
          upsells_30d: 0,
          upsell_revenue_30d: 0,
        };
        agents.set(id, b);
      }
      return b;
    };

    for (const r of rows ?? []) {
      if (!r.agent_user_id) continue;
      const b = ensure(r.agent_user_id);

      if (r.kind === "call") {
        b.calls_30d++;
        if (r.created_at >= sevenDaysISO) b.calls_7d++;
        if (r.created_at >= todayISO) b.calls_today++;
        if (r.outcome) b.outcomes[r.outcome] = (b.outcomes[r.outcome] || 0) + 1;
        if (r.duration_seconds && r.duration_seconds > 0) {
          b.total_duration_seconds += r.duration_seconds;
          b.calls_with_duration_30d++;
        }
      } else if (r.kind === "note") {
        b.notes_30d++;
      }

      if (r.follow_up_at && r.follow_up_at >= futureCutoffISO) {
        b.active_followups++;
      }
    }

    // Layer in upsell attributions (one query, may add agents not yet in the map)
    const { data: upsellRows, error: upsellErr } = await supabaseAdmin.rpc(
      "agent_upsell_stats",
      { p_schema: SCHEMA, p_since: sinceISO }
    );
    if (upsellErr) {
      logger.error("agent_upsell_stats failed", { error: upsellErr.message });
    } else if (Array.isArray(upsellRows)) {
      for (const r of upsellRows as UpsellStatsRow[]) {
        if (!r.agent_user_id) continue;
        const b = ensure(r.agent_user_id);
        b.upsells_30d = r.upsells || 0;
        b.upsell_revenue_30d =
          typeof r.upsell_revenue === "string" ? parseFloat(r.upsell_revenue) : r.upsell_revenue || 0;
      }
    }

    // Enrich with auth.users (one paginated listUsers call covers a small team)
    if (agents.size > 0) {
      const ids = new Set(agents.keys());
      let page = 1;
      const perPage = 200;
      while (ids.size > 0) {
        const { data, error: usrErr } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
        if (usrErr) {
          logger.error("listUsers failed during agent stats", { error: usrErr.message });
          break;
        }
        for (const u of data.users) {
          if (!ids.has(u.id)) continue;
          const b = agents.get(u.id);
          if (!b) continue;
          b.email = u.email ?? null;
          const meta = (u.user_metadata || {}) as Record<string, unknown>;
          const fullName = typeof meta.full_name === "string" ? meta.full_name.trim() : "";
          b.name = fullName || u.email || u.id.slice(0, 8);
          ids.delete(u.id);
        }
        if (data.users.length < perPage) break;
        page++;
        if (page > 10) break; // safety cap
      }
    }

    const list = [...agents.values()].sort((a, b) => b.calls_30d - a.calls_30d);

    const totals = list.reduce(
      (acc, b) => {
        acc.calls_today += b.calls_today;
        acc.calls_30d += b.calls_30d;
        acc.active_followups += b.active_followups;
        acc.upsells_30d += b.upsells_30d;
        acc.upsell_revenue_30d += b.upsell_revenue_30d;
        return acc;
      },
      { calls_today: 0, calls_30d: 0, active_followups: 0, upsells_30d: 0, upsell_revenue_30d: 0 }
    );

    return NextResponse.json({ agents: list, totals, window_days: WINDOW_DAYS });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("GET /api/agents/stats failed", { error: message });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
