import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getPlConfig, isPlUnlocked, plModule, plCookie } from "@/lib/pricing-lock";

const MAX_AGE = 60 * 60 * 12; // 12 часа
const CONFIG_ID = { standard: 1, key: 2 } as const;

/** Статус на заключването за модул (?module=standard|key). */
export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;
  const m = plModule(new URL(req.url).searchParams.get("module"));
  const cfg = await getPlConfig(m);
  return NextResponse.json({ hasPassword: !!cfg?.password, unlocked: await isPlUnlocked(m) });
}

/** Отключване или първоначално задаване/смяна на парола. body: { module, password?, setPassword?, newPassword? } */
export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;
  let body: { module?: string; password?: string; setPassword?: string; newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const m = plModule(body.module);
  const cfg = await getPlConfig(m);
  if (!cfg) return NextResponse.json({ error: "no config" }, { status: 500 });

  if (!cfg.password && body.setPassword) {
    if (body.setPassword.length < 4) return NextResponse.json({ error: "too short" }, { status: 400 });
    await supabaseAdmin.from("pl_config").update({ password: body.setPassword }).eq("id", CONFIG_ID[m]);
    return setUnlocked(m, cfg.unlock_token);
  }
  if (body.newPassword) {
    if (body.password !== cfg.password) return NextResponse.json({ error: "wrong" }, { status: 401 });
    if (body.newPassword.length < 4) return NextResponse.json({ error: "too short" }, { status: 400 });
    await supabaseAdmin.from("pl_config").update({ password: body.newPassword }).eq("id", CONFIG_ID[m]);
    return setUnlocked(m, cfg.unlock_token);
  }
  if (body.password && body.password === cfg.password) return setUnlocked(m, cfg.unlock_token);
  return NextResponse.json({ error: "wrong" }, { status: 401 });
}

function setUnlocked(m: "standard" | "key", token: string) {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(plCookie(m), token, { httpOnly: true, sameSite: "lax", secure: true, maxAge: MAX_AGE, path: "/" });
  return res;
}
