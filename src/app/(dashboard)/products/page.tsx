"use client";

import dynamic from "next/dynamic";
import { useState, useMemo } from "react";
import useSWR from "swr";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { ChangeBadge } from "@/components/shared/Badge";
import { KpiSkeleton, Skeleton } from "@/components/shared/Skeleton";
import { useDateRange } from "@/hooks/useDateRange";
import {
  ShoppingCart,
  Repeat,
  Package,
  TrendingUp,
  Search,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type SortKey = "revenue" | "quantity" | "orders" | "avgPrice";
type SortDir = "asc" | "desc";

interface Product {
  title: string;
  quantity: number;
  revenue: number;
  orders: number;
  avgPrice: number;
}

interface ProductData {
  period: string;
  summary: {
    totalRevenue: number;
    totalOrders: number;
    avgOrderValue: number;
    uniqueProducts: number;
    upsellRate: number;
  };
  allProducts: Product[];
  topCombos: { combo: string; count: number }[];
  timeSeries: { date: string; revenue: number }[];
  changes: { revenue: number; orders: number; aov: number; upsellRate: number };
}

export default function ProductsPage() {
  const { queryString, label } = useDateRange();
  const { data, isLoading } = useSWR<ProductData>(
    `/api/dashboard/products-analytics?${queryString}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [showAll, setShowAll] = useState(false);

  const filteredProducts = useMemo(() => {
    if (!data?.allProducts) return [];
    let products = data.allProducts;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      products = products.filter((p) => p.title.toLowerCase().includes(q));
    }

    products = [...products].sort((a, b) => {
      const mult = sortDir === "desc" ? -1 : 1;
      return (a[sortKey] - b[sortKey]) * mult;
    });

    return showAll ? products : products.slice(0, 15);
  }, [data?.allProducts, searchQuery, sortKey, sortDir, showAll]);

  const totalCount = data?.allProducts?.length || 0;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  if (isLoading) {
    return (
      <>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          {[1, 2, 3, 4, 5].map((i) => <KpiSkeleton key={i} />)}
        </div>
        <Card><CardBody><Skeleton className="h-64 w-full" /></CardBody></Card>
      </>
    );
  }

  const s = data?.summary;
  const ch = data?.changes;
  const maxRevenue = data?.timeSeries?.length
    ? Math.max(...data.timeSeries.map((d) => d.revenue))
    : 0;

  return (
    <>
      {/* KPIs with comparison */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <KpiWithChange icon={TrendingUp} label={`Revenue (${label})`} value={`${s?.totalRevenue?.toLocaleString("bg-BG")} EUR`} change={ch?.revenue} />
        <KpiWithChange icon={ShoppingCart} label="Поръчки" value={String(s?.totalOrders || 0)} change={ch?.orders} />
        <KpiWithChange icon={Package} label="Среден чек" value={`${s?.avgOrderValue?.toFixed(2)} EUR`} change={ch?.aov} />
        <KpiWithChange icon={Repeat} label="Upsell Rate" value={`${s?.upsellRate}%`} change={ch?.upsellRate} />
        <div className="bg-surface rounded-xl shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2">
            <Package size={16} className="text-text-3" />
            <span className="text-[11px] font-medium uppercase tracking-wider text-text-3">Продукти</span>
          </div>
          <div className="text-[22px] font-bold tracking-tight text-text">{s?.uniqueProducts || 0}</div>
        </div>
      </div>

      {/* Revenue Timeline */}
      {data?.timeSeries && data.timeSeries.length > 1 && (
        <Card className="mb-4">
          <CardHeader>Дневен приход</CardHeader>
          <CardBody>
            <div className="flex items-end gap-[2px] h-24">
              {data.timeSeries.map((d) => {
                const pct = maxRevenue > 0 ? (d.revenue / maxRevenue) * 100 : 0;
                return (
                  <div
                    key={d.date}
                    className="flex-1 bg-accent/20 hover:bg-accent/40 rounded-t transition-colors relative group"
                    style={{ height: `${Math.max(pct, 2)}%` }}
                  >
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block bg-text text-surface text-[10px] px-2 py-1 rounded whitespace-nowrap z-10">
                      {d.date}: {d.revenue} EUR
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between mt-2 text-[10px] text-text-3">
              <span>{data.timeSeries[0]?.date}</span>
              <span>{data.timeSeries[data.timeSeries.length - 1]?.date}</span>
            </div>
          </CardBody>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* All Products with Search & Sort */}
        <Card className="lg:col-span-2">
          <CardHeader
            action={
              <span className="text-[12px] text-text-3">{totalCount} продукта</span>
            }
          >
            Всички продукти
          </CardHeader>
          <CardBody>
            {/* Search */}
            <div className="relative mb-4">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
              <input
                type="text"
                placeholder="Търси продукт..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-surface-2 border border-border rounded-lg text-[13px] text-text outline-none focus:border-accent transition-colors placeholder:text-text-3"
              />
            </div>

            {/* Table header with sorting */}
            <div className="grid grid-cols-12 gap-2 pb-2 mb-1 border-b border-border">
              <div className="col-span-1 text-[11px] font-medium uppercase tracking-wider text-text-3">#</div>
              <div className="col-span-4 text-[11px] font-medium uppercase tracking-wider text-text-3">Продукт</div>
              <SortHeader label="Бройки" col="col-span-2" sortKey="quantity" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
              <SortHeader label="Revenue" col="col-span-2" sortKey="revenue" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
              <SortHeader label="Поръчки" col="col-span-1" sortKey="orders" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
              <SortHeader label="Ср. цена" col="col-span-2" sortKey="avgPrice" currentKey={sortKey} dir={sortDir} onToggle={toggleSort} />
            </div>

            {/* Rows */}
            {filteredProducts.map((p, i) => (
              <div
                key={p.title}
                className="grid grid-cols-12 gap-2 py-2.5 items-center hover:bg-surface-2 rounded-lg px-1 transition-colors"
              >
                <div className="col-span-1 text-[12px] font-bold text-text-3">{i + 1}</div>
                <div className="col-span-4 text-[13px] font-medium text-text truncate">{p.title}</div>
                <div className="col-span-2 text-right text-[13px] text-text-2">{p.quantity}</div>
                <div className="col-span-2 text-right text-[14px] font-semibold text-text">{p.revenue.toFixed(2)}</div>
                <div className="col-span-1 text-right text-[13px] text-text-2">{p.orders}</div>
                <div className="col-span-2 text-right text-[12px] text-text-3">{p.avgPrice.toFixed(2)} EUR</div>
              </div>
            ))}

            {!showAll && totalCount > 15 && (
              <button
                onClick={() => setShowAll(true)}
                className="w-full mt-3 py-2.5 rounded-lg bg-surface-2 text-text-2 text-[13px] font-medium hover:bg-border transition-colors cursor-pointer"
              >
                Покажи всички {totalCount} продукта
              </button>
            )}
            {showAll && totalCount > 15 && (
              <button
                onClick={() => setShowAll(false)}
                className="w-full mt-3 py-2.5 rounded-lg bg-surface-2 text-text-2 text-[13px] font-medium hover:bg-border transition-colors cursor-pointer"
              >
                Покажи по-малко
              </button>
            )}
          </CardBody>
        </Card>

        {/* Top Combos */}
        <Card>
          <CardHeader>Топ комбинации</CardHeader>
          <CardBody>
            <p className="text-[12px] text-text-3 mb-4">Най-често купувани заедно</p>
            {data?.topCombos?.map((c, i) => (
              <div key={c.combo} className="pb-3 mb-3 border-b border-border last:border-0 last:mb-0 last:pb-0">
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex items-center justify-center w-6 h-6 rounded-md bg-accent-soft text-accent text-[11px] font-bold">{i + 1}</div>
                  <span className="text-[13px] font-semibold text-text">{c.count}x</span>
                </div>
                <p className="text-[12px] text-text-2 leading-relaxed pl-8">{c.combo}</p>
              </div>
            ))}
            {(!data?.topCombos || data.topCombos.length === 0) && (
              <div className="text-center py-8 text-text-3 text-[13px]">Няма комбинации</div>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function KpiWithChange({
  icon: Icon,
  label,
  value,
  change,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  change?: number;
}) {
  return (
    <div className="bg-surface rounded-xl shadow-sm p-5">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className="text-text-3" />
        <span className="text-[11px] font-medium uppercase tracking-wider text-text-3">{label}</span>
      </div>
      <div className="text-[22px] font-bold tracking-tight text-text mb-1">{value}</div>
      {change !== undefined && <ChangeBadge value={change} />}
    </div>
  );
}

function SortHeader({
  label,
  col,
  sortKey: key,
  currentKey,
  dir,
  onToggle,
}: {
  label: string;
  col: string;
  sortKey: SortKey;
  currentKey: SortKey;
  dir: SortDir;
  onToggle: (key: SortKey) => void;
}) {
  const isActive = currentKey === key;
  return (
    <button
      onClick={() => onToggle(key)}
      className={`${col} text-right text-[11px] font-medium uppercase tracking-wider flex items-center justify-end gap-1 cursor-pointer ${
        isActive ? "text-accent" : "text-text-3 hover:text-text-2"
      }`}
    >
      {label}
      {isActive ? (
        dir === "desc" ? <ChevronDown size={12} /> : <ChevronUp size={12} />
      ) : (
        <ArrowUpDown size={10} className="opacity-40" />
      )}
    </button>
  );
}
