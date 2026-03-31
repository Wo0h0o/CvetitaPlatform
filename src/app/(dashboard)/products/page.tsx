"use client";

import useSWR from "swr";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { KpiSkeleton } from "@/components/shared/Skeleton";
import { Skeleton } from "@/components/shared/Skeleton";
import { ShoppingCart, Repeat, Package, TrendingUp } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface ProductData {
  period: string;
  summary: {
    totalRevenue: number;
    totalOrders: number;
    avgOrderValue: number;
    uniqueProducts: number;
    upsellRate: number;
  };
  topProducts: {
    title: string;
    quantity: number;
    revenue: number;
    orders: number;
    avgPrice: number;
  }[];
  topCombos: { combo: string; count: number }[];
}

export default function ProductsPage() {
  const { data, isLoading } = useSWR<ProductData>(
    "/api/dashboard/products-analytics",
    fetcher,
    { revalidateOnFocus: false }
  );

  if (isLoading) {
    return (
      <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[1, 2, 3, 4].map((i) => <KpiSkeleton key={i} />)}
        </div>
        <Card><CardBody><Skeleton className="h-64 w-full" /></CardBody></Card>
      </>
    );
  }

  const s = data?.summary;

  return (
    <>
      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <MiniKpi icon={TrendingUp} label="Revenue (30д)" value={`${s?.totalRevenue?.toLocaleString("bg-BG")} EUR`} />
        <MiniKpi icon={ShoppingCart} label="Поръчки (30д)" value={String(s?.totalOrders || 0)} />
        <MiniKpi icon={Package} label="Среден чек" value={`${s?.avgOrderValue?.toFixed(2)} EUR`} />
        <MiniKpi icon={Repeat} label="Upsell Rate" value={`${s?.upsellRate}%`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Top Products */}
        <Card className="lg:col-span-2">
          <CardHeader>Топ 10 продукти (30 дни)</CardHeader>
          <CardBody>
            {/* Table header */}
            <div className="grid grid-cols-12 gap-2 pb-2 mb-2 border-b border-border text-[11px] font-medium uppercase tracking-wider text-text-3">
              <div className="col-span-1">#</div>
              <div className="col-span-5">Продукт</div>
              <div className="col-span-2 text-right">Бройки</div>
              <div className="col-span-2 text-right">Revenue</div>
              <div className="col-span-2 text-right">Ср. цена</div>
            </div>
            {data?.topProducts?.map((p, i) => (
              <div
                key={p.title}
                className="grid grid-cols-12 gap-2 py-2.5 items-center hover:bg-surface-2 rounded-lg px-1 transition-colors"
              >
                <div className="col-span-1 text-[12px] font-bold text-text-3">{i + 1}</div>
                <div className="col-span-5 text-[13px] font-medium text-text truncate">{p.title}</div>
                <div className="col-span-2 text-right text-[13px] text-text-2">{p.quantity} бр.</div>
                <div className="col-span-2 text-right text-[14px] font-semibold text-text">{p.revenue.toFixed(2)}</div>
                <div className="col-span-2 text-right text-[12px] text-text-3">{p.avgPrice.toFixed(2)} EUR</div>
              </div>
            ))}
            {(!data?.topProducts || data.topProducts.length === 0) && (
              <div className="text-center py-8 text-text-3 text-[13px]">Няма данни</div>
            )}
          </CardBody>
        </Card>

        {/* Top Upsell Combos */}
        <Card>
          <CardHeader>Топ комбинации</CardHeader>
          <CardBody>
            <p className="text-[12px] text-text-3 mb-4">
              Най-често купувани заедно (30 дни)
            </p>
            {data?.topCombos?.map((c, i) => (
              <div
                key={c.combo}
                className="pb-3 mb-3 border-b border-border last:border-0 last:mb-0 last:pb-0"
              >
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex items-center justify-center w-6 h-6 rounded-md bg-accent-soft text-accent text-[11px] font-bold">
                    {i + 1}
                  </div>
                  <span className="text-[13px] font-semibold text-text">
                    {c.count}x пъти
                  </span>
                </div>
                <p className="text-[12px] text-text-2 leading-relaxed pl-8">
                  {c.combo}
                </p>
              </div>
            ))}
            {(!data?.topCombos || data.topCombos.length === 0) && (
              <div className="text-center py-8 text-text-3 text-[13px]">
                Няма upsell комбинации
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function MiniKpi({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-surface rounded-xl shadow-sm p-5">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className="text-text-3" />
        <span className="text-[11px] font-medium uppercase tracking-wider text-text-3">{label}</span>
      </div>
      <div className="text-[22px] font-bold tracking-tight text-text">{value}</div>
    </div>
  );
}
