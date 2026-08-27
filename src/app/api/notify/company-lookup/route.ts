import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchWithTimeout } from "@/lib/fetch-utils";

/**
 * GET /api/notify/company-lookup?eik=XXXXXXXXX
 * Returns a saved company (if we already know this EIK), otherwise looks up
 * name + registered address from the EU VIES service. The manager (управител)
 * is not in VIES, so the UI collects it once and saves the company for reuse.
 */
export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const eik = (new URL(req.url).searchParams.get("eik") || "").replace(/\D/g, "");
  if (!eik) return NextResponse.json({ error: "eik required" }, { status: 400 });

  // вече запазена фирма?
  const { data: saved } = await supabaseAdmin.from("nz_companies").select("*").eq("eik", eik).maybeSingle();
  if (saved) return NextResponse.json({ source: "saved", company: saved });

  // VIES (ЕС ДДС) — име + адрес
  try {
    const res = await fetchWithTimeout(
      `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/BG/vat/${eik}`,
      { headers: { Accept: "application/json" } },
      12000
    );
    const v = await res.json();
    if (v?.isValid) {
      const name = String(v.name || "").replace(/\s*-\s*(ООД|ЕООД|АД|ЕАД)\s*$/i, "").trim();
      return NextResponse.json({
        source: "vies",
        company: { eik, name, address: (v.address || "").replace(/\s+/g, " ").trim(), vat: `BG${eik}`, manager: "" },
      });
    }
    return NextResponse.json({ source: "vies", company: { eik, name: "", address: "", vat: `BG${eik}`, manager: "" }, note: "VIES не намери валиден номер — попълни ръчно." });
  } catch {
    return NextResponse.json({ source: "none", company: { eik, name: "", address: "", vat: `BG${eik}`, manager: "" }, note: "Няма връзка с VIES — попълни ръчно." });
  }
}
