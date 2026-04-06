import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { logger, requestMeta } from "./logger";

/**
 * Checks for a valid NextAuth JWT session.
 * Returns a 401 Response if unauthorized, or null if the request is allowed.
 *
 * Usage in any API route:
 *   const authError = await requireAuth(req);
 *   if (authError) return authError;
 */
export async function requireAuth(
  req: NextRequest
): Promise<NextResponse | null> {
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  });

  if (!token) {
    logger.security("Auth rejected", requestMeta(req));
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

/**
 * Validates a cron secret header (used by Vercel Cron Jobs).
 * MANDATORY: if CRON_SECRET is not set, the endpoint rejects ALL requests.
 *
 * Usage:
 *   const cronError = requireCronSecret(request);
 *   if (cronError) return cronError;
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
