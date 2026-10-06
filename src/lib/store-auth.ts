import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export interface StoreContext {
  userId: string;
  email: string | null;
  role: string;
  storeId: number | null; // към кой магазин е вързан (за роля „store")
  canAllStores: boolean; // admin/manager виждат всички магазини
}

/** Резолвва потребител + роля + вързан магазин за магазинния портал. */
export async function getStoreContext(req: NextRequest | Request): Promise<StoreContext | null> {
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        if ("cookies" in req && typeof (req as NextRequest).cookies.getAll === "function") return (req as NextRequest).cookies.getAll();
        const header = (req as Request).headers.get("cookie") ?? "";
        return header.split(";").map((s) => s.trim()).filter(Boolean).map((pair) => {
          const eq = pair.indexOf("=");
          return eq === -1 ? { name: pair, value: "" } : { name: pair.slice(0, eq), value: decodeURIComponent(pair.slice(eq + 1)) };
        });
      },
      setAll() {},
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: member } = await supabase
    .from("organization_members")
    .select("role, store_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return null;
  const role = String(member.role);
  return {
    userId: user.id,
    email: user.email ?? null,
    role,
    storeId: member.store_id != null ? Number(member.store_id) : null,
    canAllStores: role === "admin" || role === "manager" || role === "viewer" || role === "agent",
  };
}
