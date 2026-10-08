import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Публичен списък с имена за PIN екрана (без PIN-ове). */
export async function GET() {
  const { data, error } = await supabaseAdmin.from("prod_workers").select("id, name").eq("active", true).order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ workers: data ?? [] });
}
