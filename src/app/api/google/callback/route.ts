import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { exchangeCode } from "@/lib/google";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/** Google OAuth callback — записва refresh_token в google_auth, връща към /pricing-status. */
export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;
  const url = new URL(req.url);
  const origin = url.origin;
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");
  const back = `${origin}/pricing-status`;
  if (err) return NextResponse.redirect(`${back}?google=denied`);
  if (!code) return NextResponse.redirect(`${back}?google=missing_code`);
  try {
    const redirectUri = `${origin}/api/google/callback`;
    const { refresh_token, email } = await exchangeCode(code, redirectUri);
    if (!refresh_token) {
      // Google връща refresh_token само при първо съгласие; prompt=consent го форсира.
      return NextResponse.redirect(`${back}?google=no_refresh`);
    }
    await supabaseAdmin
      .from("google_auth")
      .upsert({ id: 1, email: email ?? null, refresh_token, updated_at: new Date().toISOString() }, { onConflict: "id" });
    return NextResponse.redirect(`${back}?google=connected`);
  } catch (e) {
    logger.error("google/callback failed", { error: e instanceof Error ? e.message : String(e) });
    return NextResponse.redirect(`${back}?google=error`);
  }
}
