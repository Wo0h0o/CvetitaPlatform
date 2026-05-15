import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { createServerClient } from "@supabase/ssr";

// Paths a worker is allowed to visit. Everything else gets redirected to /hr.
// Workers can also visit /settings — but the settings page itself hides the
// org-wide fields when role === 'worker', exposing only their HR profile.
const WORKER_ALLOWED_PREFIXES = ["/hr", "/settings"];

function isWorkerAllowed(pathname: string): boolean {
  if (pathname === "/") return false; // worker home is /hr, not /
  return WORKER_ALLOWED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

export async function middleware(request: NextRequest) {
  const { user, supabaseResponse } = await updateSession(request);

  if (!user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Resolve role via a lightweight DB read. We reuse the same Supabase SSR
  // client wiring so the auth cookie is honoured. organization_members has
  // an index on user_id (idx_org_members_user), so this is a single PK-ish
  // lookup per request — acceptable for the middleware hot path.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {
          // Token refresh already handled by updateSession() above.
        },
      },
    }
  );

  const { data: member } = await supabase
    .from("organization_members")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  const role = member?.role ?? null;
  const pathname = request.nextUrl.pathname;

  if (role === "worker" && !isWorkerAllowed(pathname)) {
    return NextResponse.redirect(new URL("/hr", request.url));
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
