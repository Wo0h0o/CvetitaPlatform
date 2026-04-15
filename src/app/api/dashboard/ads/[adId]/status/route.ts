import { NextRequest, NextResponse } from "next/server";
import { updateMetaAdStatus } from "@/lib/meta";
import { requireAuth } from "@/lib/api-auth";

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

  const ok = await updateMetaAdStatus(adId, status, integrationAccountId);
  if (!ok) {
    return NextResponse.json({ error: "Failed to update ad status" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, adId, newStatus: status });
}
