import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export type MemberRole = "admin" | "manager" | "viewer" | "agent" | "worker";

export interface UserContext {
  userId: string;
  organizationId: string;
  role: MemberRole;
}

/**
 * Resolves (userId, organizationId, role) for the current request.
 * Returns null if unauthenticated or not a member of any org.
 *
 * Use this in API routes AND in the middleware to gate access. A user with
 * `role === 'worker'` must only see /hr/* (and the slim /settings profile
 * page). Everything else is for admin / manager / viewer / agent.
 */
export async function getUserContext(
  req: NextRequest | Request
): Promise<UserContext | null> {
  // Both NextRequest and Request expose cookies differently. We only ever
  // call this from server-side code, so we accept either signature and
  // extract cookies via the request's Cookie header when needed.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          // NextRequest has .cookies.getAll(); plain Request needs parsing
          if ("cookies" in req && typeof (req as NextRequest).cookies.getAll === "function") {
            return (req as NextRequest).cookies.getAll();
          }
          const header = (req as Request).headers.get("cookie") ?? "";
          return header
            .split(";")
            .map((s) => s.trim())
            .filter(Boolean)
            .map((pair) => {
              const eq = pair.indexOf("=");
              return eq === -1
                ? { name: pair, value: "" }
                : { name: pair.slice(0, eq), value: decodeURIComponent(pair.slice(eq + 1)) };
            });
        },
        setAll() {
          // No-op: token refresh is handled in the middleware
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: member } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member) return null;

  return {
    userId: user.id,
    organizationId: member.organization_id,
    role: member.role as MemberRole,
  };
}

/** Worker = restricted role with HR-only access. */
export function isWorker(role: MemberRole): boolean {
  return role === "worker";
}

/** Manager-or-admin can manage HR data for the whole org. */
export function isManagerOrAdmin(role: MemberRole): boolean {
  return role === "admin" || role === "manager";
}
