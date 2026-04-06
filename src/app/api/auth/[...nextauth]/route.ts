import { NextRequest } from "next/server";
import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

const nextAuthHandler = NextAuth(authOptions);

// GET requests (session checks, CSRF token) pass through unthrottled
export { nextAuthHandler as GET };

// POST requests (login attempts) are rate-limited: 10 per minute per IP
export async function POST(req: NextRequest, ctx: { params: Promise<{ nextauth: string[] }> }) {
  const limited = rateLimit(req, { limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  return nextAuthHandler(req, ctx);
}
