import { NextRequest, NextResponse } from "next/server";
import { updateMetaAdStatus } from "@/lib/meta";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ adId: string }> }
) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  if (!process.env.META_ACCESS_TOKEN) {
    return NextResponse.json({ error: "Meta Ads not configured" }, { status: 400 });
  }

  const { adId } = await params;

  let body: { status?: string; integrationAccountId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const status = body.status;
  if (status !== "ACTIVE" && status !== "PAUSED") {
    return NextResponse.json({ error: "Status must be ACTIVE or PAUSED" }, { status: 400 });
  }

  // The ad's source account must be passed explicitly — an ad from
  // act_ProteinBar won't resolve under Cvetita's primary token. The client
  // picks this up from the row's integration_account_id field (populated by
  // the per-account fan-out in /api/dashboard/ads/individual/route.ts).
  // Absent in the body → fall back to the env-default client, preserving
  // legacy single-account behaviour.
  const integrationAccountId = body.integrationAccountId || undefined;

  // Authorization: with an agency token that has multi-account reach, the
  // client could otherwise toggle an ad from account A while claiming it
  // belongs to account B. Verify the adId actually belongs to the passed
  // integration_account_id before forwarding to Meta. If the ad isn't in
  // our local cache yet, fall through — Meta itself will reject out-of-scope
  // writes, and this route's legacy single-account path shouldn't be broken
  // for ads we've never synced.
  if (integrationAccountId) {
    const { data: adRow } = await supabaseAdmin
      .from("meta_insights_daily")
      .select("integration_account_id")
      .eq("level", "ad")
      .eq("object_id", adId)
      .limit(1)
      .maybeSingle();

    if (adRow && adRow.integration_account_id !== integrationAccountId) {
      return NextResponse.json(
        { error: "ad-account mismatch" },
        { status: 403 }
      );
    }
  }

  const ok = await updateMetaAdStatus(adId, status, integrationAccountId);
  if (!ok) {
    return NextResponse.json({ error: "Failed to update ad status" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, adId, newStatus: status });
}
