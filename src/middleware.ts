import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { user, supabaseResponse } = await updateSession(request);

  if (!user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  // IMPORTANT: return supabaseResponse, not NextResponse.next()
  // It carries refreshed auth cookies
  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!login|api|_next/static|_next/image|favicon).*)",
  ],
};
