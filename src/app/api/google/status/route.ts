import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getGoogleAuth } from "@/lib/google";

/** Връща дали Google е свързан и за кой акаунт. */
export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;
  const auth = await getGoogleAuth();
  return NextResponse.json({ connected: !!auth?.refresh_token, email: auth?.email ?? null });
}
