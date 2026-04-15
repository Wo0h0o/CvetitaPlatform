import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

// ============================================================
// POST /api/dashboard/action/dismiss
//
// Body: { briefId: string }
//
// No Meta call — just flips agent_briefs.status='dismissed'. The card
// disappears from the Owner Home on the next SWR revalidation.
// ============================================================

interface DismissBody {
  briefId?: string;
}

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  let body: DismissBody;
  try {
    body = (await req.json()) as DismissBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { briefId } = body;
  if (!briefId) {
    return NextResponse.json({ error: "briefId required" }, { status: 400 });
  }

  // Load the brief so we can return a clean 404 if it doesn't exist, and
  // refuse to re-dismiss an already-actioned card. (The UPDATE below would
  // succeed with 0 rows affected, but the user deserves a clearer signal.)
  const { data: brief, error: briefErr } = await supabaseAdmin
    .from("agent_briefs")
    .select("id, status")
    .eq("id", briefId)
    .maybeSingle();

  if (briefErr || !brief) {
    return NextResponse.json({ error: "Brief not found" }, { status: 404 });
  }
  if (brief.status !== "pending") {
    return NextResponse.json({ error: "Brief already actioned" }, { status: 409 });
  }

  const { error: updateErr } = await supabaseAdmin
    .from("agent_briefs")
    .update({ status: "dismissed", actioned_at: new Date().toISOString() })
    .eq("id", briefId);

  if (updateErr) {
    logger.error("action/dismiss: agent_briefs update failed", {
      briefId,
      error: updateErr.message,
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
