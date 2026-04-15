import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { logger } from "@/lib/logger";

// ============================================================
// Types
// ============================================================

type Severity = "red" | "amber" | "green";
type ActionKey = "pause" | "scale" | "review" | "dismiss";

interface ActionTarget {
  type: "ad" | "adset" | "campaign" | "product" | "segment";
  id: string;
  name: string;
}

interface ActionCard {
  id: string;
  severity: Severity;
  title: string;
  why: string;
  target: ActionTarget;
  actions: ActionKey[];
}

interface ActionCardsResponse {
  cards: ActionCard[];
}

// ============================================================
// Stubs — W3 scaffolding only.
// Replace the body of this route in W4 with a query against agent_briefs.
// ============================================================

const STUB_CARDS: ActionCard[] = [
  {
    id: "stub-1",
    severity: "red",
    title: "Пауза на „BG - TOF - Video 3“",
    why: "CPA €18.40, +140% за 7 дни",
    target: { type: "ad", id: "stub-ad-001", name: "BG - TOF - Video 3" },
    actions: ["pause", "dismiss"],
  },
  {
    id: "stub-2",
    severity: "amber",
    title: "Прегледай „GR - Retargeting - Carousel“",
    why: "ROAS спада под медианата за 3 дни подред",
    target: { type: "adset", id: "stub-adset-002", name: "GR - Retargeting - Carousel" },
    actions: ["review", "dismiss"],
  },
  {
    id: "stub-3",
    severity: "green",
    title: "Скалирай „RO - Cold - UGC v2“",
    why: "ROAS 4.8, +35% vs типичен вторник",
    target: { type: "campaign", id: "stub-camp-003", name: "RO - Cold - UGC v2" },
    actions: ["scale", "dismiss"],
  },
];

// ============================================================
// Route
// ============================================================

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const response: ActionCardsResponse = { cards: STUB_CARDS };
    return NextResponse.json(response, {
      headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=30" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("GET /api/dashboard/home/action-cards failed", { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
