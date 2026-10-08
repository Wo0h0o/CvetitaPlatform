import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getCexWorker } from "@/lib/cex-auth";
import { reviewByDate, applyReview, type ItemStatus } from "@/lib/prod-logic";

/** Супервайзър (телефон): преглед по дата + одобрение/връщане ПО ОПЕРАЦИЯ. */
export async function GET(req: NextRequest) {
  const w = await getCexWorker(req);
  if (!w?.is_supervisor) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const date = new URL(req.url).searchParams.get("date") || new Date().toISOString().slice(0, 10);
  return NextResponse.json(await reviewByDate(date));
}

export async function PATCH(req: NextRequest) {
  const w = await getCexWorker(req);
  if (!w?.is_supervisor) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  if (!b.entry_id || !["confirmed", "rejected", "submitted"].includes(b.status)) return NextResponse.json({ error: "entry_id и валиден status" }, { status: 400 });
  try {
    const entry = await applyReview(Number(b.entry_id), { lineId: b.line_id, status: b.status as ItemStatus, note: b.note ?? null });
    return NextResponse.json({ entry });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
