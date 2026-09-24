import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getPlConfig, isPlUnlocked, PL_COOKIE } from "@/lib/pricing-lock";

const MAX_AGE = 60 * 60 * 12; // 12 часа

/** Статус на заключването. */
export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;
  const cfg = await getPlConfig();
  return NextResponse.json({ hasPassword: !!cfg?.password, unlocked: await isPlUnlocked() });
}

/** Отключване (или първоначално задаване на парола). */
export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;
  let body: { password?: string; setPassword?: string; newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const cfg = await getPlConfig();
  if (!cfg) return NextResponse.json({ error: "no config" }, { status: 500 });

  // задаване на първа парола (когато още няма зададена)
  if (!cfg.password && body.setPassword) {
    if (body.setPassword.length < 4) return NextResponse.json({ error: "too short" }, { status: 400 });
    await supabaseAdmin.from("pl_config").update({ password: body.setPassword }).eq("id", 1);
    return setUnlocked(cfg.unlock_token);
  }
  // смяна на паролата (изисква текущата)
  if (body.newPassword) {
    if (body.password !== cfg.password) return NextResponse.json({ error: "wrong" }, { status: 401 });
    if (body.newPassword.length < 4) return NextResponse.json({ error: "too short" }, { status: 400 });
    await supabaseAdmin.from("pl_config").update({ password: body.newPassword }).eq("id", 1);
    return setUnlocked(cfg.unlock_token);
  }
  // обикновено отключване
  if (body.password && body.password === cfg.password) return setUnlocked(cfg.unlock_token);
  return NextResponse.json({ error: "wrong" }, { status: 401 });
}

function setUnlocked(token: string) {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(PL_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: true, maxAge: MAX_AGE, path: "/" });
  return res;
}
