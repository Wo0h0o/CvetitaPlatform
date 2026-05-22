"use client";

import useSWR from "swr";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { Skeleton } from "@/components/shared/Skeleton";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function fmtEur(n: number): string {
  return `€${Math.round(n).toLocaleString("bg-BG")}`;
}

// ============================================================
// Breakdown grid — the operational layer between the account KPIs
// and the 50 individual ad cards. Three distinct budget questions:
// where the spend goes, how healthy the creatives are, which
// campaigns carry the account.
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
  campaigns,
}: {
  market: string;
  preset: string;
  ads: { score: number }[];
  campaigns: CampaignLite[];
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
      <PlacementCard market={market} preset={preset} />
      <CreativeHealthCard ads={ads} />
      <CampaignsCard campaigns={campaigns} />
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
  const { data, isLoading } = useSWR<{ placements: Placement[]; error?: string }>(
    `/api/dashboard/ads/placements?market=${market}&preset=${preset}`,
    fetcher,
    { revalidateOnFocus: false }
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

function CreativeHealthCard({ ads }: { ads: { score: number }[] }) {
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
        {total === 0 ? (
          <p className="text-[13px] text-text-2">Зареждане...</p>
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

function CampaignsCard({ campaigns }: { campaigns: CampaignLite[] }) {
  const top = [...campaigns].sort((a, b) => b.spend - a.spend).slice(0, 6);
  const max = Math.max(...top.map((c) => c.spend), 1);

  return (
    <Card>
      <CardHeader>Кампании</CardHeader>
      <CardBody>
        {top.length === 0 ? (
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
