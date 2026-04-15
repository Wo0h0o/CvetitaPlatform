import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { sofiaDate } from "@/lib/sofia-date";

// ============================================================
// Types — must stay in sync with src/components/dashboard/ActionCard.tsx.
// Extended in W4: ActionTarget now carries integrationAccountId so the
// mutation routes know which Meta account to hit.
// ============================================================

type Severity = "red" | "amber" | "green";
type ActionKey = "pause" | "scale" | "review" | "dismiss";

interface ActionTarget {
  type: "ad" | "adset" | "campaign" | "product" | "segment";
  id: string;
  name: string;
  integrationAccountId?: string;
}

interface ActionCard {
  id: string;
  severity: Severity;
  title: string;
  why: string;
  target: ActionTarget;
  actions: ActionKey[];
}

interface ActionCardsResponse {
  cards: ActionCard[];
  error?: string;
}

interface BriefRow {
  id: string;
  severity: Severity;
  title: string;
  why: string;
  target_type: "ad" | "adset" | "campaign";
  target_id: string;
  target_name: string | null;
  actions: ActionKey[] | null;
  integration_account_id: string;
}

// ============================================================
// GET — serves today's pending briefs, sorted by severity (red first).
// ============================================================

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const forDate = sofiaDate();

    // Fetch pending briefs for today. supabase-js can't express a
    // `ORDER BY CASE severity ...` custom ordering directly, so we sort
    // in JS after the fetch (at most ~30 rows so the cost is trivial).
    const { data, error } = await supabaseAdmin
      .from("agent_briefs")
      .select(
        "id, severity, title, why, target_type, target_id, target_name, actions, integration_account_id"
      )
      .eq("for_date", forDate)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(30);

    if (error) {
      logger.error("action-cards: agent_briefs fetch failed", { error: error.message });
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }

    const rows = (data ?? []) as BriefRow[];
    const severityRank: Record<Severity, number> = { red: 0, amber: 1, green: 2 };
    rows.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

    const cards: ActionCard[] = rows.slice(0, 10).map((r) => ({
      id: r.id,
      severity: r.severity,
      title: r.title,
      why: r.why,
      target: {
        type: r.target_type,
        id: r.target_id,
        name: r.target_name ?? "",
        integrationAccountId: r.integration_account_id,
      },
      actions: (r.actions ?? []) as ActionKey[],
    }));

    const response: ActionCardsResponse = { cards };
    return NextResponse.json(response, {
      headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=30" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("GET /api/dashboard/home/action-cards failed", { error: message });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
