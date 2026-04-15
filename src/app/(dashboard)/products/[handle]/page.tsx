/* eslint-disable @next/next/no-img-element */
"use client";

import { use } from "react";
import useSWR from "swr";
import Link from "next/link";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { KpiSkeleton, Skeleton } from "@/components/shared/Skeleton";
import { Badge } from "@/components/shared/Badge";
import { PageHeader } from "@/components/shared/PageHeader";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { useDateRange } from "@/hooks/useDateRange";
import { MiniKpi } from "@/components/shared/MiniKpi";
import {
  ArrowLeft,
  TrendingUp,
  ShoppingCart,
  Package,
  Tag,
} from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Variant {
  id: number;
  title: string;
  price: string;
  compareAtPrice: string | null;
  sku: string;
  inventory: number;
  tracked: boolean;
}

interface ProductDetail {
  product: {
    title: string;
    handle: string;
    description: string;
    vendor: string;
    productType: string;
    tags: string[];
    createdAt: string;
    images: { src: string; alt: string | null }[];
    mainImage: string | null;
    variants: Variant[];
  };
  sales: {
    revenue: number;
    quantity: number;
    orders: number;
    avgPrice: number;
    timeSeries: { date: string; revenue: number; quantity: number }[];
  };
  boughtWith: { title: string; count: number }[];
  error?: string;
}

export default function ProductDetailPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = use(params);
  const { queryString, label } = useDateRange();
  const { data, isLoading } = useSWR<ProductDetail>(
    `/api/dashboard/products/${handle}?${queryString}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  const fmt = (n: number) =>
    n.toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (isLoading) {
    return (
      <>
        <PageHeader title="">
          <DateRangePicker />
        </PageHeader>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[1, 2, 3, 4].map((i) => <KpiSkeleton key={i} />)}
        </div>
        <Card><CardBody><Skeleton className="h-48 w-full" /></CardBody></Card>
      </>
    );
  }

  if (data?.error || !data?.product) {
    return (
      <>
        <div className="mb-6">
          <Link href="/products" className="flex items-center gap-2 text-[13px] text-text-3 hover:text-text transition-colors">
            <ArrowLeft size={16} /> Назад към продукти
          </Link>
        </div>
        <Card>
          <CardBody>
            <div className="text-center py-16 text-text-3">
              Продуктът не е намерен
            </div>
          </CardBody>
        </Card>
      </>
    );
  }

  const { product, sales, boughtWith } = data;
  const mainPrice = product.variants?.[0]?.price;
  const maxRevenue = sales.timeSeries.length > 0
    ? Math.max(...sales.timeSeries.map((d) => d.revenue))
    : 0;

  return (
    <>
      {/* Back + Title */}
      <div className="mb-2">
        <Link href="/products" className="flex items-center gap-2 text-[13px] text-text-3 hover:text-text transition-colors">
          <ArrowLeft size={16} /> Продукти
        </Link>
      </div>
      <PageHeader title={product.title}>
        <DateRangePicker />
      </PageHeader>

      {/* Product Hero */}
      <Card className="mb-6">
        <CardBody>
          <div className="flex flex-col md:flex-row gap-6">
            {product.mainImage && (
              <img
                src={product.mainImage}
                alt={product.title}
                className="w-full md:w-40 h-40 object-contain rounded-xl bg-surface-2 flex-shrink-0"
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                {product.vendor && (
                  <Badge variant="green">{product.vendor}</Badge>
                )}
                {product.productType && (
                  <Badge variant="neutral">{product.productType}</Badge>
                )}
              </div>
              {mainPrice && (
                <div className="text-[24px] font-bold text-text mb-3">
                  {parseFloat(mainPrice).toFixed(2)} EUR
                </div>
              )}
              {product.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {product.tags.slice(0, 8).map((tag) => (
                    <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-2 text-[12px] text-text-2">
                      <Tag size={10} />
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Sales KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <MiniKpi
          icon={TrendingUp}
          label={`Revenue (${label})`}
          value={`${fmt(sales.revenue)} EUR`}
        />
        <MiniKpi
          icon={Package}
          label="Продадени бройки"
          value={String(sales.quantity)}
        />
        <MiniKpi
          icon={ShoppingCart}
          label="Поръчки"
          value={String(sales.orders)}
        />
        <MiniKpi
          icon={TrendingUp}
          label="Средна цена"
          value={`${fmt(sales.avgPrice)} EUR`}
        />
      </div>

      {/* Revenue Timeline */}
      {sales.timeSeries.length > 1 && (
        <Card className="mb-6">
          <CardHeader>Дневен приход</CardHeader>
          <CardBody>
            <div className="flex items-end gap-[2px] h-32">
              {sales.timeSeries.map((d) => {
                const pct = maxRevenue > 0 ? (d.revenue / maxRevenue) * 100 : 0;
                return (
                  <div
                    key={d.date}
                    className="flex-1 bg-accent/20 hover:bg-accent/40 rounded-t transition-colors relative group"
                    style={{ height: `${Math.max(pct, 2)}%` }}
                  >
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block bg-text text-surface text-[10px] px-2 py-1 rounded whitespace-nowrap z-10">
                      {d.date}: {d.revenue.toFixed(2)} EUR ({d.quantity} бр.)
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between mt-2 text-[11px] text-text-2">
              <span>{sales.timeSeries[0]?.date}</span>
              <span>{sales.timeSeries[sales.timeSeries.length - 1]?.date}</span>
            </div>
          </CardBody>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Variants */}
        {product.variants.length > 0 && product.variants[0].title !== "Default Title" && (
          <Card>
            <CardHeader>Варианти</CardHeader>
            <CardBody>
              <div className="overflow-x-auto -mx-5 px-5">
                <div className="min-w-[400px]">
                  <div className="grid grid-cols-12 gap-2 pb-2 mb-1 border-b border-border text-[13px] font-semibold text-text">
                    <div className="col-span-5">Вариант</div>
                    <div className="col-span-3 text-right">Цена</div>
                    <div className="col-span-2 text-right">SKU</div>
                    <div className="col-span-2 text-right">Наличност</div>
                  </div>
                  {product.variants.map((v) => (
                    <div key={v.id} className="grid grid-cols-12 gap-2 py-2.5 items-center hover:bg-surface-2 rounded-lg px-1 transition-colors">
                      <div className="col-span-5 text-[13px] font-medium text-text">{v.title}</div>
                      <div className="col-span-3 text-right text-[13px] text-text">
                        {parseFloat(v.price).toFixed(2)} EUR
                        {v.compareAtPrice && (
                          <span className="ml-1 text-[11px] text-text-3 line-through">
                            {parseFloat(v.compareAtPrice).toFixed(2)}
                          </span>
                        )}
                      </div>
                      <div className="col-span-2 text-right text-[12px] text-text-2">{v.sku || "—"}</div>
                      <div className="col-span-2 text-right">
                        {v.tracked ? (
                          <Badge variant={v.inventory > 0 ? "green" : "neutral"}>
                            {v.inventory > 0 ? v.inventory : "Out"}
                          </Badge>
                        ) : (
                          <span className="text-[12px] text-text-2">Неограничено</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardBody>
          </Card>
        )}

        {/* Bought Together */}
        {boughtWith.length > 0 && (
          <Card>
            <CardHeader>Купуват се заедно с</CardHeader>
            <CardBody>
              <div className="space-y-1">
                {boughtWith.map((item, i) => (
                  <div
                    key={item.title}
                    className="flex items-center gap-3 py-2.5 px-2 rounded-lg hover:bg-surface-2 transition-colors"
                  >
                    <div className="flex items-center justify-center w-6 h-6 rounded-md bg-accent-soft text-accent text-[11px] font-bold flex-shrink-0">
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-text truncate">{item.title}</div>
                    </div>
                    <span className="text-[13px] font-semibold text-text-2 flex-shrink-0">{item.count}x</span>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        )}

        {/* Single variant — show inventory inline */}
        {product.variants.length === 1 && product.variants[0].title === "Default Title" && (
          <Card>
            <CardHeader>Информация</CardHeader>
            <CardBody>
              <div className="space-y-3">
                <div className="flex justify-between text-[13px]">
                  <span className="text-text-2">Цена</span>
                  <span className="font-medium text-text">{parseFloat(product.variants[0].price).toFixed(2)} EUR</span>
                </div>
                {product.variants[0].sku && (
                  <div className="flex justify-between text-[13px]">
                    <span className="text-text-2">SKU</span>
                    <span className="font-medium text-text">{product.variants[0].sku}</span>
                  </div>
                )}
                <div className="flex justify-between text-[13px]">
                  <span className="text-text-2">Наличност</span>
                  {product.variants[0].tracked ? (
                    <Badge variant={product.variants[0].inventory > 0 ? "green" : "neutral"}>
                      {product.variants[0].inventory > 0 ? `${product.variants[0].inventory} бр.` : "Изчерпан"}
                    </Badge>
                  ) : (
                    <span className="text-[13px] font-medium text-accent">Винаги наличен</span>
                  )}
                </div>
                <div className="flex justify-between text-[13px]">
                  <span className="text-text-2">Добавен</span>
                  <span className="text-text-2">
                    {new Date(product.createdAt).toLocaleDateString("bg-BG", { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                </div>
              </div>
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}

