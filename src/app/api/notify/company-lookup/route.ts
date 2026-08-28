import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchWithTimeout } from "@/lib/fetch-utils";
import { logger } from "@/lib/logger";

/**
 * GET /api/notify/company-lookup?eik=XXXXXXXXX
 *
 * Auto-extracts a Bulgarian company's name / seat address / manager by EIK.
 * Priority: (1) already-saved company, (2) public Trade-Register catalogue
 * (papagal.bg — covers VAT and non-VAT firms), (3) VIES fallback (VAT only).
 * Nothing is persisted here — the UI decides when to save.
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const stripTags = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const cleanAddr = (s: string) =>
  stripTags(s)
    .replace(/^БЪЛГАРИЯ,\s*/i, "")
    .replace(/\s*Има\s+\d+\s+фирм[аи].*$/i, "") // papagal UI артефакт
    .replace(/\s*виж фирмите.*$/i, "")
    .replace(/[„“”"]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// Пълен браузърски набор хедъри — за да мине Cloudflare филтъра от сървъра (Vercel IP).
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  "Accept-Language": "bg-BG,bg;q=0.9,en;q=0.8",
  "sec-ch-ua": '"Chromium";v="126", "Google Chrome";v="126", "Not.A/Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "Upgrade-Insecure-Requests": "1",
};

/** Trade-Register catalogue (papagal.bg): EIK → {name, address, manager}. */
async function lookupPapagal(eik: string): Promise<{ name: string; address: string; manager: string; has_vat?: boolean } | null> {
  const acRes = await fetchWithTimeout(
    `https://papagal.bg/autocomplete/?query=${eik}`,
    { headers: { ...BROWSER_HEADERS, Accept: "application/json, text/javascript, */*; q=0.01", Referer: "https://papagal.bg/", "X-Requested-With": "XMLHttpRequest", "Sec-Fetch-Dest": "empty", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Site": "same-origin" } },
    12000
  );
  if (!acRes.ok) throw new Error(`papagal autocomplete ${acRes.status}`);
  const ac = await acRes.json();
  const hit = ac?.companies?.[0];
  if (!hit?.url) return null;

  const pageRes = await fetchWithTimeout(
    `https://papagal.bg${hit.url}`,
    { headers: { ...BROWSER_HEADERS, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", Referer: "https://papagal.bg/", "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "same-origin", "Sec-Fetch-User": "?1" } },
    12000
  );
  if (!pageRes.ok) throw new Error(`papagal page ${pageRes.status}`);
  const html = await pageRes.text();

  // Definition list: <dt>label</dt><dd>value</dd>
  const map: Record<string, string> = {};
  for (const m of html.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g)) {
    map[stripTags(m[1])] = m[2];
  }
  const address = map["Седалище адрес"] ? cleanAddr(map["Седалище адрес"]) : "";

  // Управител: имената са <a href="/p/…">ИМЕ</a> връзки в блока „Представляващи".
  const reprRaw = map["Представляващи"] || "";
  const names = [...reprRaw.matchAll(/<a[^>]*href=['"]\/p\/[^'"]*['"][^>]*>([^<]+)<\/a>/g)].map((m) => m[1].trim()).filter(Boolean);
  let manager = [...new Set(names)].join(", ");
  if (!manager) {
    // fallback: текстов формат „Управител: ИМЕ (свързан…)"
    const mm = stripTags(reprRaw).match(/(?:Управител|Представляващ|Прокурист)[^:]*:\s*([^(]+?)(?:\s*\(|$)/);
    if (mm) manager = mm[1].trim();
  }

  return { name: String(hit.name_bg || hit.name_en || "").trim(), address, manager, has_vat: hit.has_vat };
}

/** VIES fallback (VAT-registered only). */
async function lookupVies(eik: string): Promise<{ name: string; address: string } | null> {
  const res = await fetchWithTimeout(`https://ec.europa.eu/taxation_customs/vies/rest-api/ms/BG/vat/${eik}`, { headers: { Accept: "application/json" } }, 10000);
  const v = await res.json();
  if (!v?.isValid) return null;
  return { name: String(v.name || "").trim(), address: (v.address || "").replace(/\s+/g, " ").trim() };
}

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const eik = (new URL(req.url).searchParams.get("eik") || "").replace(/\D/g, "");
  if (!eik) return NextResponse.json({ error: "eik required" }, { status: 400 });

  // 1) вече запазена фирма
  const { data: saved } = await supabaseAdmin.from("nz_companies").select("*").eq("eik", eik).maybeSingle();
  if (saved) return NextResponse.json({ source: "saved", company: saved });

  // 2) Търговски регистър (papagal) — всички фирми
  try {
    const p = await lookupPapagal(eik);
    if (p && p.name) {
      return NextResponse.json({
        source: "papagal",
        company: { eik, name: p.name, address: p.address, manager: p.manager, vat: p.has_vat ? `BG${eik}` : "" },
      });
    }
  } catch (e) {
    logger.error("papagal lookup failed", { error: String(e) });
  }

  // 3) VIES fallback
  try {
    const v = await lookupVies(eik);
    if (v) return NextResponse.json({ source: "vies", company: { eik, name: v.name, address: v.address, manager: "", vat: `BG${eik}` } });
  } catch {
    /* ignore */
  }

  return NextResponse.json({ source: "none", company: { eik, name: "", address: "", manager: "" }, note: "Не намерих фирмата автоматично — попълни ръчно." });
}
