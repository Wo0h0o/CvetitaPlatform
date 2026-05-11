import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { rateLimit } from "@/lib/rate-limit";
import { fetchProductCatalog } from "@/lib/shopify";
import { suggestProductMappings } from "@/lib/competitor-mapping";
import { logger, requestMeta } from "@/lib/logger";

export const maxDuration = 30;

// POST /api/competitors/[slug]/mappings/suggest
// Body: { competitorProductUrl, competitorProductName }
// Returns: top 3 candidate Shopify products with confidence + reasoning.
export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const limited = rateLimit(req, { limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  try {
    const body = await req.json();
    const { competitorProductUrl, competitorProductName } = body as {
      competitorProductUrl?: string;
      competitorProductName?: string;
    };

    if (!competitorProductUrl || !competitorProductName) {
      return NextResponse.json(
        { error: "competitorProductUrl + competitorProductName required" },
        { status: 400 }
      );
    }

    const catalog = await fetchProductCatalog();
    if (catalog.length === 0) {
      return NextResponse.json({ suggestions: [] });
    }

    const suggestions = await suggestProductMappings(
      { name: competitorProductName, url: competitorProductUrl },
      catalog
    );

    return NextResponse.json({ suggestions });
  } catch (err) {
    logger.error("Mapping suggest failed", { ...requestMeta(req), error: String(err) });
    return NextResponse.json(
      { error: "AI suggest failed: " + String(err) },
      { status: 500 }
    );
  }
}
