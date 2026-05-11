"use client";

import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { Badge } from "@/components/shared/Badge";
import { ExternalLink, Globe, Package, Boxes, AlertCircle, Link2 } from "lucide-react";
import { marketFlag, marketLabel } from "@/lib/competitor-markets";

interface OverviewTabProps {
  competitor: {
    domain: string | null;
    markets: string[];
    sisterDomains: string[];
  };
  stats: {
    productsTracked: number;
    inStock: number;
    unreadAlerts: number;
    mappedProducts: number;
  };
  latestPrices: Array<{
    product_name: string;
    product_url: string;
    price: number;
    currency: string;
    in_stock: boolean;
  }>;
}

export function OverviewTab({ competitor, stats, latestPrices }: OverviewTabProps) {
  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile icon={Package} label="Tracked продукти" value={String(stats.productsTracked)} />
        <KpiTile icon={Boxes} label="Налични в склад" value={`${stats.inStock} / ${stats.productsTracked}`} />
        <KpiTile icon={Link2} label="Mapped към наши" value={String(stats.mappedProducts)} />
        <KpiTile icon={AlertCircle} label="Непрочетени промени" value={String(stats.unreadAlerts)} variant={stats.unreadAlerts > 0 ? "red" : "neutral"} />
      </div>

      {/* Markets */}
      <Card>
        <CardHeader>Пазари и присъствие</CardHeader>
        <CardBody>
          {competitor.markets.length === 0 ? (
            <p className="text-[13px] text-text-3">
              Все още не са установени пазари. Стартирай scan, за да се извлекат hreflang + валута сигнали.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2 mb-4">
              {competitor.markets.map((m) => (
                <span
                  key={m}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-2 text-[13px] text-text"
                >
                  <span className="text-[16px]">{marketFlag(m)}</span>
                  <span>{marketLabel(m)}</span>
                  <span className="text-text-3 text-[11px]">({m})</span>
                </span>
              ))}
            </div>
          )}

          {competitor.sisterDomains.length > 0 && (
            <div>
              <div className="text-[12px] text-text-3 mb-2">Свързани домейни (от hreflang):</div>
              <div className="flex flex-col gap-1">
                {competitor.sisterDomains.map((d) => (
                  <a
                    key={d}
                    href={`https://${d}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-[13px] text-accent hover:underline w-fit"
                  >
                    <Globe size={11} />
                    {d}
                    <ExternalLink size={9} />
                  </a>
                ))}
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Last products preview */}
      <Card>
        <CardHeader action={<Badge variant="neutral">{latestPrices.length}</Badge>}>
          Последни tracked продукти
        </CardHeader>
        <CardBody>
          {latestPrices.length === 0 ? (
            <p className="text-[13px] text-text-3">Няма данни. Стартирай scan.</p>
          ) : (
            <div className="space-y-1">
              {latestPrices.slice(0, 8).map((p) => (
                <div key={p.product_url} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
                  <span className="text-[13px] text-text flex-1 truncate">{p.product_name}</span>
                  <span className="text-[13px] font-semibold text-text flex-shrink-0">
                    {p.price.toFixed(2)} {p.currency}
                  </span>
                  {!p.in_stock && (
                    <Badge variant="orange">не налично</Badge>
                  )}
                  <a
                    href={p.product_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-text-3 hover:text-text-2 flex-shrink-0"
                  >
                    <ExternalLink size={12} />
                  </a>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function KpiTile({
  icon: Icon,
  label,
  value,
  variant = "neutral",
}: {
  icon: typeof Package;
  label: string;
  value: string;
  variant?: "neutral" | "red";
}) {
  return (
    <Card>
      <CardBody className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <Icon size={14} className={variant === "red" ? "text-red" : "text-text-3"} />
          <span className="text-[11px] text-text-3 uppercase tracking-wide">{label}</span>
        </div>
        <div className={`text-[20px] font-semibold ${variant === "red" ? "text-red" : "text-text"}`}>{value}</div>
      </CardBody>
    </Card>
  );
}
