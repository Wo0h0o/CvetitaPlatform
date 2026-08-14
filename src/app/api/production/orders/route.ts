import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/**
 * Production orders (Възлагателни писма) tracking.
 * GET   — list all orders (newest first).
 * POST  — issue a new order { letter_no?, issued_date?, items[] }.
 * PATCH — update an order { id, status?, letter_no?, items? }.
 */

interface OrderItem {
  item_id: string;
  sku?: string;
  name: string;
  qty: number;
  size?: string;
  unit?: string;
  status?: "pending" | "produced";
  produced_date?: string | null;
  produced_qty?: number | null;
}

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const { data, error } = await supabaseAdmin
    .from("production_orders")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("production/orders GET failed", { error: error.message });
    return NextResponse.json({ error: "Fetch failed" }, { status: 500 });
  }
  return NextResponse.json({ orders: data ?? [] });
}

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  let body: { letter_no?: string; issued_date?: string; items?: OrderItem[]; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "items[] required" }, { status: 400 });
  }

  const items = body.items.map((it) => ({
    ...it,
    status: it.status ?? "pending",
    produced_date: it.produced_date ?? null,
    produced_qty: it.produced_qty ?? 0,
  }));

  const { data, error } = await supabaseAdmin
    .from("production_orders")
    .insert({
      letter_no: body.letter_no ?? null,
      issued_date: body.issued_date ?? undefined,
      items,
      note: body.note ?? null,
    })
    .select()
    .single();

  if (error) {
    logger.error("production/orders POST failed", { error: error.message });
    return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  }
  logger.info("production order issued", { id: data.id, items: items.length });
  return NextResponse.json({ order: data });
}

export async function PATCH(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  let body: { id?: number; status?: string; letter_no?: string; items?: OrderItem[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.status !== undefined) patch.status = body.status;
  if (body.letter_no !== undefined) patch.letter_no = body.letter_no;
  if (body.items !== undefined) patch.items = body.items;

  const { data, error } = await supabaseAdmin
    .from("production_orders")
    .update(patch)
    .eq("id", body.id)
    .select()
    .single();

  if (error) {
    logger.error("production/orders PATCH failed", { error: error.message });
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
  return NextResponse.json({ order: data });
}

export async function DELETE(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await supabaseAdmin.from("production_orders").delete().eq("id", Number(id));
  if (error) {
    logger.error("production/orders DELETE failed", { error: error.message });
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
