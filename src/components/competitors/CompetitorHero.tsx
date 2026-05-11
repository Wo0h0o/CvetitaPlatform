"use client";

import Link from "next/link";
import { Card, CardBody } from "@/components/shared/Card";
import { Badge } from "@/components/shared/Badge";
import { Button } from "@/components/shared/Button";
import { ArrowLeft, ExternalLink, Globe, Scan, Loader2, Shield, Megaphone } from "lucide-react";
import { marketFlag, marketLabel } from "@/lib/competitor-markets";

interface CompetitorHeroProps {
  competitor: {
    name: string;
    slug: string;
    domain: string | null;
    facebook_page: string | null;
    category: string;
    markets: string[];
    lastScanAt: string | null;
  };
  scanning: boolean;
  onScan: () => void;
}

function formatTimeAgo(iso: string | null): string {
  if (!iso) return "никога";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "току-що";
  if (mins < 60) return `преди ${mins} мин`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `преди ${hours}ч`;
  const days = Math.floor(hours / 24);
  return `преди ${days}д`;
}

export function CompetitorHero({ competitor: c, scanning, onScan }: CompetitorHeroProps) {
  return (
    <div className="mb-6">
      {/* Back link */}
      <Link
        href="/competitors"
        className="inline-flex items-center gap-1 text-[12px] text-text-3 hover:text-text-2 mb-3 transition-colors"
      >
        <ArrowLeft size={12} />
        Всички конкуренти
      </Link>

      <Card>
        <CardBody>
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-12 h-12 rounded-xl bg-red-soft flex items-center justify-center flex-shrink-0">
                <Shield size={20} className="text-red" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-[20px] font-semibold text-text">{c.name}</h1>
                  <Badge variant={c.category === "direct" ? "red" : c.category === "indirect" ? "orange" : "neutral"}>
                    {c.category}
                  </Badge>
                </div>
                {c.domain && (
                  <a
                    href={`https://${c.domain}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[12px] text-text-2 hover:text-accent transition-colors mt-1"
                  >
                    <Globe size={11} />
                    {c.domain}
                    <ExternalLink size={9} />
                  </a>
                )}
                {/* Markets row */}
                {c.markets.length > 0 && (
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <span className="text-[11px] text-text-3">Пазари:</span>
                    {c.markets.map((m) => (
                      <span
                        key={m}
                        title={marketLabel(m)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-2 text-[11px] text-text-2"
                      >
                        <span>{marketFlag(m)}</span>
                        <span>{m}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col items-end gap-2 flex-shrink-0">
              <div className="text-[11px] text-text-3">
                Последен scan: <span className="text-text-2">{formatTimeAgo(c.lastScanAt)}</span>
              </div>
              <div className="flex items-center gap-2">
                {c.facebook_page && (
                  <a
                    href={`https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BG&q=${encodeURIComponent(c.name)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button variant="secondary" size="sm">
                      <Megaphone size={12} />
                      Ad Library
                    </Button>
                  </a>
                )}
                {c.domain && (
                  <Button onClick={onScan} disabled={scanning} size="sm">
                    {scanning ? (
                      <><Loader2 size={12} className="animate-spin" /> Сканиране…</>
                    ) : (
                      <><Scan size={12} /> Сканирай</>
                    )}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
