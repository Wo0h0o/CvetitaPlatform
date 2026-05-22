"use client";

import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { Skeleton } from "@/components/shared/Skeleton";
import { ErrorState } from "@/components/shared/ErrorState";
import { useAnalyticsSWR } from "@/hooks/useAnalyticsSWR";

function fmtEur(n: number): string {
  return `€${Math.round(n).toLocaleString("bg-BG")}`;
}

// ============================================================
// Breakdown grid — the operational layer between the account KPIs
// and the 50 individual ad cards. Three distinct budget questions:
// where the spend goes, how healthy the creatives are, which
// campaigns carry the account.
//
// Each card designs all three states (CLAUDE.md §8): loading skeleton,
// error (ErrorState — distinct from empty), and a real empty result.
// ============================================================

interface CampaignLite {
  name: string;
  spend: number;
  roas: number;
}

export function AdsBreakdown({
  market,
  preset,
  ads,
  adsLoading,
  campaigns,
  campaignsError,
}: {
  market: string;
  preset: string;
  ads: { score: number }[];
  /** True while the individual-ads fetch is in flight — lets
   *  CreativeHealthCard tell "still loading" from "0 ads". */
  adsLoading: boolean;
  campaigns: CampaignLite[];
  /** The overview fetch (campaigns source) failed. */
  campaignsError: boolean;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
      <PlacementCard market={market} preset={preset} />
      <CreativeHealthCard ads={ads} adsLoading={adsLoading} />
      <CampaignsCard campaigns={campaigns} hasError={campaignsError} />
    </div>
  );
}

// ---------- Placement ----------

interface Placement {
  platform: string;
  spend: number;
  roas: number;
  share: number;
}

const PLATFORM_LABEL: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  audience_network: "Audience Network",
  messenger: "Messenger",
  unknown: "Друго",
};

function PlacementCard({ market, preset }: { market: string; preset: string }) {
  // useAnalyticsSWR + jsonFetcher surface HTTP !ok and `{ error }` soft
  // failures as a thrown ApiError — no more "no data" masking a 500.
  const { data, error, isLoading, mutate } = useAnalyticsSWR<{ placements: Placement[] }>(
    `/api/dashboard/ads/placements?market=${market}&preset=${preset}`
  );
  const placements = data?.placements ?? [];
  const max = Math.max(...placements.map((p) => p.spend), 1);

  return (
    <Card>
      <CardHeader>Платформи</CardHeader>
      <CardBody>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-9 w-full" />)}
          </div>
        ) : error ? (
          <ErrorState error={error} onRetry={() => mutate()} compact />
        ) : placements.length === 0 ? (
          <p className="text-[13px] text-text-2">Няма данни за периода</p>
        ) : (
          <div className="space-y-3">
            {placements.map((p) => (
              <div key={p.platform}>
                <div className="flex items-center justify-between gap-2 text-[13px] mb-1">
                  <span className="text-text truncate">
                    {PLATFORM_LABEL[p.platform] ?? p.platform}
                    <span className="text-text-3 ml-1.5">ROAS {p.roas.toFixed(1)}x</span>
                  </span>
                  <span className="text-text-2 tabular-nums flex-shrink-0">
                    {fmtEur(p.spend)} · {Math.round(p.share * 100)}%
                  </span>
                </div>
                <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-full"
                    style={{ width: `${(p.spend / max) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ---------- Creative health ----------

// Five score tiers, accent→neutral→red ladder (design contract §1 — no
// categorical colours, opacity for hierarchy).
const SCORE_TIERS: { min: number; label: string; color: string }[] = [
  { min: 80, label: "Топ", color: "bg-accent" },
  { min: 60, label: "Добра", color: "bg-accent/55" },
  { min: 40, label: "Средна", color: "bg-text-3" },
  { min: 20, label: "Под средната", color: "bg-red/50" },
  { min: 0, label: "Слаба", color: "bg-red" },
];

function CreativeHealthCard({
  ads,
  adsLoading,
}: {
  ads: { score: number }[];
  adsLoading: boolean;
}) {
  const buckets = SCORE_TIERS.map((t) => ({ ...t, count: 0 }));
  for (const a of ads) {
    const idx = SCORE_TIERS.findIndex((t) => a.score >= t.min);
    buckets[idx >= 0 ? idx : buckets.length - 1].count++;
  }
  const total = ads.length;

  return (
    <Card>
      <CardHeader>Креативно здраве</CardHeader>
      <CardBody>
        {adsLoading ? (
          <>
            <Skeleton className="h-3 w-full rounded-full mb-3" />
            <div className="space-y-1.5">
              {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-4 w-full" />)}
            </div>
          </>
        ) : total === 0 ? (
          // Genuine empty — the fetch finished and the account has no ads.
          <p className="text-[13px] text-text-2">Няма активни реклами за периода</p>
        ) : (
          <>
            <div className="flex h-3 rounded-full overflow-hidden bg-surface-2 mb-3">
              {buckets.map(
                (b) =>
                  b.count > 0 && (
                    <div
                      key={b.label}
                      className={b.color}
                      style={{ width: `${(b.count / total) * 100}%` }}
                    />
                  )
              )}
            </div>
            <div className="space-y-1.5">
              {buckets.map((b) => (
                <div
                  key={b.label}
                  className="flex items-center justify-between text-[12px]"
                >
                  <span className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-sm ${b.color}`} />
                    <span className="text-text-2">{b.label}</span>
                  </span>
                  <span className="text-text tabular-nums">{b.count}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

// ---------- Campaigns ----------

function CampaignsCard({
  campaigns,
  hasError,
}: {
  campaigns: CampaignLite[];
  hasError: boolean;
}) {
  const top = [...campaigns].sort((a, b) => b.spend - a.spend).slice(0, 6);
  const max = Math.max(...top.map((c) => c.spend), 1);

  return (
    <Card>
      <CardHeader>Кампании</CardHeader>
      <CardBody>
        {hasError ? (
          // No own fetch — error is signalled by the parent's overview SWR.
          <ErrorState compact />
        ) : top.length === 0 ? (
          <p className="text-[13px] text-text-2">Няма кампании за периода</p>
        ) : (
          <div className="space-y-3">
            {top.map((c, i) => (
              <div key={`${c.name}-${i}`}>
                <div className="flex items-center justify-between gap-2 text-[13px] mb-1">
                  <span className="text-text truncate">{c.name}</span>
                  <span className="text-text-2 tabular-nums flex-shrink-0">
                    {fmtEur(c.spend)}
                  </span>
                </div>
                <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-full"
                    style={{ width: `${(c.spend / max) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
