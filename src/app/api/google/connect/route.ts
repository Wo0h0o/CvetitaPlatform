import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { authUrl } from "@/lib/google";

/** Стартира Google OAuth (Gmail + Calendar) — пренасочва към Google. */
export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;
  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/api/google/callback`;
  return NextResponse.redirect(authUrl(redirectUri));
}
