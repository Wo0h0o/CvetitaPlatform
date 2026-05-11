"use client";

import { useMemo, useState } from "react";
import useSWR, { mutate } from "swr";
import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { Badge } from "@/components/shared/Badge";
import { Skeleton } from "@/components/shared/Skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { MappingModal } from "./MappingModal";
import {
  Link2, Unlink, ExternalLink, ArrowUp, ArrowDown, Minus, Sparkles, Package, Plus,
} from "lucide-react";

const fetcher = (url: string) => fetch(url).then(async (r) => {
  const json = await r.json();
  if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`);
  return json;
});

interface LatestPrice {
  product_name: string;
  product_url: string;
  price: number;
  currency: string;
  in_stock: boolean;
  scraped_at: string;
}

interface MappingRow {
  id: string;
  competitorProductUrl: string;
  competitorProductName: string;
  competitorPrice: number | null;
  competitorCurrency: string | null;
  ourShopifyProductId: string;
  ourHandle: string;
  ourProductName: string;
  ourPrice: number | null;
  ourCurrency: string;
  diffPct: number | null;
  mappingConfidence: "manual" | "ai_suggested";
  ourActive: boolean;
}

interface CatalogMapTabProps {
  competitorSlug: string;
  latestPrices: LatestPrice[];
}

export function CatalogMapTab({ competitorSlug, latestPrices }: CatalogMapTabProps) {
  const { data, isLoading, error } = useSWR<{ mappings: MappingRow[] }>(
    `/api/competitors/${competitorSlug}/mappings`,
    fetcher,
    { revalidateOnFocus: false }
  );

  const [modalProduct, setModalProduct] = useState<LatestPrice | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const mappingsByUrl = useMemo(() => {
    const map = new Map<string, MappingRow>();
    for (const m of data?.mappings || []) {
      map.set(m.competitorProductUrl, m);
    }
    return map;
  }, [data]);

  const mappedCount = data?.mappings.length ?? 0;
  const unmappedCount = latestPrices.length - mappedCount;

  const handleDelete = async (mappingId: string) => {
    if (!confirm("Премахни този mapping?")) return;
    setDeletingId(mappingId);
    try {
      const res = await fetch(`/api/competitors/${competitorSlug}/mappings/${mappingId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("delete failed");
      await mutate(`/api/competitors/${competitorSlug}/mappings`);
    } catch {
      // Toast omitted to keep deps light; error UI minimal.
    } finally {
      setDeletingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardBody>
          <p className="text-[13px] text-red">Грешка при зареждане: {String(error.message)}</p>
        </CardBody>
      </Card>
    );
  }

  if (latestPrices.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="Няма tracked продукти"
        description="Стартирай scan, за да започнат да се извличат продукти на конкурента."
      />
    );
  }

  return (
    <>
      <Card>
        <CardHeader
          action={
            <div className="flex items-center gap-2 text-[12px]">
              <Badge variant="green">{mappedCount} mapped</Badge>
              <Badge variant="neutral">{unmappedCount} unmapped</Badge>
            </div>
          }
        >
          Каталогна карта
        </CardHeader>
        <CardBody className="p-0">
          <div className="divide-y divide-border">
            {latestPrices.map((p) => {
              const mapping = mappingsByUrl.get(p.product_url);
              return (
                <CatalogRow
                  key={p.product_url}
                  product={p}
                  mapping={mapping}
                  deleting={mapping ? deletingId === mapping.id : false}
                  onMap={() => setModalProduct(p)}
                  onUnmap={mapping ? () => handleDelete(mapping.id) : undefined}
                />
              );
            })}
          </div>
        </CardBody>
      </Card>

      <MappingModal
        open={!!modalProduct}
        onClose={() => setModalProduct(null)}
        competitor={{ slug: competitorSlug }}
        product={
          modalProduct
            ? {
                url: modalProduct.product_url,
                name: modalProduct.product_name,
                price: modalProduct.price,
                currency: modalProduct.currency,
              }
            : null
        }
        onSaved={() => {
          mutate(`/api/competitors/${competitorSlug}/mappings`);
        }}
      />
    </>
  );
}

function CatalogRow({
  product: p,
  mapping,
  deleting,
  onMap,
  onUnmap,
}: {
  product: LatestPrice;
  mapping: MappingRow | undefined;
  deleting: boolean;
  onMap: () => void;
  onUnmap?: () => void;
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-center gap-3 px-4 py-3 hover:bg-surface-2 transition-colors">
      {/* Their product */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <a
            href={p.product_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] font-medium text-text truncate hover:text-accent transition-colors"
            title={p.product_name}
          >
            {p.product_name}
          </a>
          <ExternalLink size={10} className="text-text-3 flex-shrink-0" />
        </div>
        <div className="text-[12px] text-text-2 mt-0.5 flex items-center gap-2">
          <span className="font-semibold">{p.price.toFixed(2)} {p.currency}</span>
          {!p.in_stock && <span className="text-orange">не налично</span>}
        </div>
      </div>

      {/* Arrow */}
      <div className="hidden md:flex text-text-3 flex-shrink-0">→</div>

      {/* Mapping side */}
      <div className="flex-1 min-w-0">
        {mapping ? (
          <MappedSide mapping={mapping} />
        ) : (
          <button
            onClick={onMap}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-text-2 border border-dashed border-border-strong hover:bg-surface hover:text-text cursor-pointer transition-colors"
          >
            <Plus size={12} />
            Свържи
          </button>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {mapping && (
          <button
            onClick={onUnmap}
            disabled={deleting}
            title="Премахни mapping"
            className="p-2 rounded-lg text-text-3 hover:text-red hover:bg-red-soft transition-colors cursor-pointer disabled:opacity-50"
          >
            <Unlink size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function MappedSide({ mapping }: { mapping: MappingRow }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Link
        href={`https://cvetitaherbal.com/products/${mapping.ourHandle}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[13px] font-medium text-text hover:text-accent transition-colors max-w-[200px] truncate"
        title={mapping.ourProductName}
      >
        <Link2 size={10} className="inline mr-1 text-accent" />
        {mapping.ourProductName}
      </Link>
      {!mapping.ourActive && <Badge variant="orange">неактивен</Badge>}
      {mapping.ourPrice !== null && (
        <span className="text-[12px] font-semibold text-text-2">
          {mapping.ourPrice.toFixed(2)} {mapping.ourCurrency}
        </span>
      )}
      <DiffBadge pct={mapping.diffPct} />
      {mapping.mappingConfidence === "ai_suggested" && (
        <span title="Свързано чрез AI" className="text-text-3">
          <Sparkles size={11} />
        </span>
      )}
    </div>
  );
}

function DiffBadge({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const abs = Math.abs(pct);
  if (abs < 1) {
    return (
      <Badge variant="neutral">
        <Minus size={10} /> ≈
      </Badge>
    );
  }
  // Positive pct = we are more expensive → "червено"
  const variant = pct > 0 ? "red" : "green";
  const Icon = pct > 0 ? ArrowUp : ArrowDown;
  return (
    <Badge variant={variant}>
      <Icon size={10} />
      {pct > 0 ? "+" : ""}
      {pct.toFixed(0)}%
    </Badge>
  );
}
