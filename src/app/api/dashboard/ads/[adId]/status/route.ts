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

  let body: { status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const status = body.status;
  if (status !== "ACTIVE" && status !== "PAUSED") {
    return NextResponse.json({ error: "Status must be ACTIVE or PAUSED" }, { status: 400 });
  }

  const ok = await updateMetaAdStatus(adId, status);
  if (!ok) {
    return NextResponse.json({ error: "Failed to update ad status" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, adId, newStatus: status });
}
