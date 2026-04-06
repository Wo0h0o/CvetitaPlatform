import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { logger, requestMeta } from "./logger";

/**
 * Checks for a valid Supabase Auth session.
 * Returns a 401 Response if unauthorized, or null if the request is allowed.
 *
 * Usage in any API route:
 *   const authError = await requireAuth(req);
 *   if (authError) return authError;
 */
export async function requireAuth(
  req: NextRequest
): Promise<NextResponse | null> {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll() {
          // No-op in API routes — middleware handles token refresh
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    logger.security("Auth rejected", requestMeta(req));
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

/**
 * Validates a cron secret header (used by Vercel Cron Jobs).
 * MANDATORY: if CRON_SECRET is not set, the endpoint rejects ALL requests.
 */
export function requireCronSecret(req: Request): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    logger.security("Cron secret not configured", requestMeta(req));
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 503 }
    );
  }

  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    logger.security("Cron auth rejected", requestMeta(req));
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
