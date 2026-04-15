import { NextRequest, NextResponse } from "next/server";
import { getMetaAdInsights, getMetaAdCreatives } from "@/lib/meta";
import { requireAuth } from "@/lib/api-auth";
import { logger } from "@/lib/logger";
import { parseAdRow, scoreAd, computeAccountMeans } from "@/lib/meta-scoring";
import { resolveAdsMarketFromRequest } from "@/lib/ads-market";

const PRESET_MAP: Record<string, string> = {
  today: "today",
  yesterday: "yesterday",
  "7d": "last_7d",
  "14d": "last_14d",
  "30d": "last_30d",
  "90d": "last_90d",
  this_month: "this_month",
  last_month: "last_month",
};

type AccountMeans = ReturnType<typeof computeAccountMeans>;

// ---------------------------------------------------------------------------
// Score + enrich the ads for ONE integration account.
// Critical: `computeAccountMeans` must be called per-account — mixing ads
// from Cvetita and ProteinBar into one mean would corrupt both accounts'
// Bayesian shrinkage priors and make ProteinBar ads score badly against
// Cvetita's ROAS baseline (or vice versa).
// ---------------------------------------------------------------------------
async function scoreAdsForAccount(
  datePreset: string,
  statusFilter: string | undefined,
  integrationAccountId?: string
) {
  const rows = await getMetaAdInsights(datePreset, statusFilter, integrationAccountId);
  const parsed = rows.map(parseAdRow);
  const means = computeAccountMeans(parsed);

  const adIds = parsed.map((a) => a.id).filter(Boolean);
  // Creatives must be fetched from the SAME account that owns the ads —
  // a creative for an ad in act_ProteinBar won't resolve under Cvetita's token.
  const creatives = await getMetaAdCreatives(adIds, integrationAccountId);

  const scored = parsed.map((ad) => {
    const creative = creatives.get(ad.id);
    const isVideo = creative?.isVideo || false;
    const scoring = scoreAd(ad, isVideo, { roas: means.roas, cpa: means.cpa });

    return {
      ...ad,
      status: creative?.effective_status || "UNKNOWN",
      thumbnail: creative?.imageUrl || null,
      videoUrl: creative?.videoUrl || null,
      isVideo,
      creativeTitle: creative?.title || null,
      creativeBody: creative?.body || null,
      score: scoring.score ?? 0,
      scoringStatus: scoring.status,
      confidence: scoring.confidence,
      diagnostics: scoring.diagnostics,
      scoreBreakdown: scoring.scoreBreakdown,
      scoreMeta: scoring.meta,
      integration_account_id: integrationAccountId ?? null,
    };
  });

  return { scored, means };
}

function fmtMeans(m: AccountMeans) {
  return {
    roas: Math.round(m.roas * 100) / 100,
    cpa: Math.round(m.cpa * 100) / 100,
    ctr: Math.round(m.ctr * 100) / 100,
    cvr: Math.round(m.cvr * 100) / 100,
    frequency: Math.round(m.frequency * 100) / 100,
  };
}

export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;
  if (!process.env.META_ACCESS_TOKEN) {
    return NextResponse.json({ error: "Meta Ads not configured" }, { status: 200 });
  }

  const { searchParams } = new URL(request.url);
  const preset = searchParams.get("preset") || "7d";
  const datePreset = PRESET_MAP[preset] || "last_7d";
  const statusFilter = searchParams.get("status") || undefined;

  let ids: string[] | null;
  try {
    ({ ids } = await resolveAdsMarketFromRequest(request));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid market";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  try {
    // Env-default path (legacy /ads/individual sub-route without market).
    if (ids === null) {
      const { scored, means } = await scoreAdsForAccount(datePreset, statusFilter);
      const ads = scored.sort((a, b) => {
        if (a.scoringStatus !== b.scoringStatus) {
          return a.scoringStatus === "scored" ? -1 : 1;
        }
        return (b.score ?? 0) - (a.score ?? 0);
      });
      return NextResponse.json(
        { ads, accountAverages: fmtMeans(means) },
        { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=60" } }
      );
    }

    // Per-market fan-out: parallel per-account scoring, merge + sort fresh.
    const perAccount = await Promise.all(
      ids.map((id) => scoreAdsForAccount(datePreset, statusFilter, id))
    );

    const ads = perAccount
      .flatMap((p) => p.scored)
      .sort((a, b) => {
        if (a.scoringStatus !== b.scoringStatus) {
          return a.scoringStatus === "scored" ? -1 : 1;
        }
        if ((b.score ?? 0) !== (a.score ?? 0)) return (b.score ?? 0) - (a.score ?? 0);
        // Deterministic tiebreak so pagination doesn't shuffle across requests.
        return a.id.localeCompare(b.id);
      });

    // `accountAverages` is preserved in the response shape for backwards
    // compatibility with the current /ads page. When fanning out across
    // multiple accounts, use the first account's means as the headline
    // figure and include the full per-account breakdown as a sibling field.
    const headlineMeans = perAccount[0]?.means ?? computeAccountMeans([]);
    const averagesByAccount: Record<string, ReturnType<typeof fmtMeans>> = {};
    ids.forEach((id, i) => {
      averagesByAccount[id] = fmtMeans(perAccount[i].means);
    });

    return NextResponse.json(
      {
        ads,
        accountAverages: fmtMeans(headlineMeans),
        accountAveragesByAccount: averagesByAccount,
      },
      { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=60" } }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Meta API fetch failed";
    logger.error("GET /api/dashboard/ads/individual failed", { error: msg });
    return NextResponse.json({ error: "Meta API fetch failed" }, { status: 500 });
  }
}
