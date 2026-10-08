import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { CEX_COOKIE, cexToken } from "@/lib/cex-auth";

/** POST {worker_id, pin} → проверка на PIN, сетва подписана бисквитка. */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const workerId = Number(body.worker_id);
  const pin = String(body.pin || "").trim();
  if (!workerId || !pin) return NextResponse.json({ error: "Избери име и въведи PIN" }, { status: 400 });
  const { data } = await supabaseAdmin.from("prod_workers").select("id, name, pin, active, is_supervisor").eq("id", workerId).maybeSingle();
  if (!data || !data.active || String(data.pin) !== pin) {
    return NextResponse.json({ error: "Грешен PIN" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true, worker: { id: data.id, name: data.name, is_supervisor: !!data.is_supervisor } });
  res.cookies.set(CEX_COOKIE, cexToken(data.id), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 14, // 14 дни
  });
  return res;
}
