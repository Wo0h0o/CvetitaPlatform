"use client";

import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { countryDisplayName } from "@/lib/geo/country-codes";

// ============================================================
// TrafficGeo — "откъде идва трафикът" country breakdown.
//
// Design contract §9: "Top X в категория" → horizontal bars +
// share %. Ranking is the question, so the bars are read as an
// order; the share % gives each row its weight in the whole.
//
// §1: categories don't get their own accent — the #1 country is
// accent, the rest are a single neutral grey. Country names are
// resolved to Bulgarian; GA4's unresolved-geo bucket reads as
// "Неизвестно" rather than being dropped.
//
// No flag glyphs: MarketFlag only covers our 8 sales markets, so
// arbitrary traffic countries would render grey placeholders —
// the country name alone is cleaner and matches the source/medium
// table on the same page.
// ============================================================

interface GeoRow {
  /** ISO alpha-2 (caps) or "(not set)". */
  country: string;
  sessions: number;
  users: number;
}

export function TrafficGeo({ geo }: { geo: GeoRow[] }) {
  const total = geo.reduce((s, r) => s + r.sessions, 0) || 1;
  const max = Math.max(...geo.map((r) => r.sessions), 1);

  return (
    <Card>
      <CardHeader>Държави</CardHeader>
      <CardBody>
        {geo.length === 0 ? (
          <p className="text-center py-8 text-[13px] text-text-2">
            Няма гео данни за периода
          </p>
        ) : (
          <div className="space-y-3">
            {geo.map((r, i) => {
              const label =
                r.country === "(not set)"
                  ? "Неизвестно"
                  : countryDisplayName(r.country, r.country);
              const share = (r.sessions / total) * 100;
              const isTop = i === 0;
              return (
                <div key={r.country}>
                  <div className="flex items-center justify-between gap-2 text-[13px] mb-1">
                    <span className="text-text truncate">{label}</span>
                    <span className="text-text-2 tabular-nums flex-shrink-0">
                      {r.sessions.toLocaleString("bg-BG")}
                      <span className="text-text-3 ml-1.5">
                        {share.toFixed(1)}%
                      </span>
                    </span>
                  </div>
                  <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        isTop ? "bg-accent" : "bg-text-3"
                      }`}
                      style={{ width: `${(r.sessions / max) * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
