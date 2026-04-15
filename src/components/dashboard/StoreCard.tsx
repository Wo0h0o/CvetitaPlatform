"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, type KeyboardEvent } from "react";
import { SparkLine } from "@/components/charts/SparkLine";
import { useChartColors } from "@/components/charts/ChartContainer";
import { FreshnessDot } from "@/components/shared/FreshnessDot";
import { ArrowRight } from "lucide-react";

// ============================================================
// Types
// ============================================================

export type BorderLevel = "red" | "amber" | "green";

export interface StoreCardData {
  /** Store UUID — used for the card-wide tap target. */
  storeId: string;
  marketCode: string;
  name: string;
  flag: string;
  sparkline14d: number[];
  roasLast24h: number;
  roasMedian14d: number;
  borderLevel: BorderLevel;
  lastSyncedAt: string | null;
}

// ============================================================
// Styling maps
// ============================================================

// Left-border accent for the whole card, by borderLevel.
const BORDER_CLASS: Record<BorderLevel, string> = {
  red: "border-l-4 border-l-red",
  amber: "border-l-4 border-l-orange",
  green: "border-l-4 border-l-accent",
};

// Short Bulgarian label for the border level — for screen readers / tooltips.
const LEVEL_LABEL: Record<BorderLevel, string> = {
  red: "под нормата",
  amber: "леко под нормата",
  green: "над нормата",
};

// ============================================================
// Formatting
// ============================================================

function fmtEur(n: number): string {
  return `${n.toLocaleString("bg-BG", { maximumFractionDigits: 0 })} EUR`;
}

// ============================================================
// Component
// ============================================================

interface StoreCardProps {
  /** Store identity + metrics — fetched from /api/dashboard/home/stores. */
  data: StoreCardData;
}

export function StoreCard({ data }: StoreCardProps) {
  const router = useRouter();
  const colors = useChartColors();

  const sparkColor = useMemo(() => {
    switch (data.borderLevel) {
      case "red":
        return colors.red;
      case "amber":
        return colors.orange;
      case "green":
        return colors.accent;
    }
  }, [data.borderLevel, colors]);

  const goToSales = () => router.push(`/sales/store/${data.storeId}`);
  const handleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      goToSales();
    }
  };

  // Whole-card tap target → Sales view for this store.
  // The "Виж реклами →" link inside uses stopPropagation to avoid also
  // triggering the card tap (Day 2 plan gotcha #5).
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={goToSales}
      onKeyDown={handleKey}
      aria-label={`Отвори продажби за ${data.name}`}
      className={`
        relative bg-surface rounded-xl shadow-sm p-5
        transition-all duration-200 hover:shadow-md hover:-translate-y-0.5
        cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent/50
        ${BORDER_CLASS[data.borderLevel]}
      `}
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[20px] leading-none">{data.flag}</span>
            <h3 className="text-[15px] font-semibold text-text truncate">
              {data.name}
            </h3>
          </div>
          <span
            className="text-[11px] text-text-3"
            aria-label={`Ниво: ${LEVEL_LABEL[data.borderLevel]}`}
          >
            {LEVEL_LABEL[data.borderLevel]}
          </span>
        </div>

        <Link
          href={`/ads/${data.marketCode}`}
          onClick={(e) => e.stopPropagation()}
          className="
            shrink-0 inline-flex items-center gap-1 text-[12px] font-medium
            text-text-2 hover:text-text px-2 py-1 rounded-md hover:bg-surface-2
            transition-colors
          "
        >
          Виж реклами
          <ArrowRight size={12} />
        </Link>
      </div>

      <div className="mb-4 h-10 w-full">
        <SparkLine
          data={data.sparkline14d}
          color={sparkColor}
          height={40}
          width={0}
          className="w-full h-full"
        />
      </div>

      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div>
            <div className="text-[20px] font-bold text-text leading-tight">
              {fmtEur(lastValue(data.sparkline14d))}
            </div>
            {/* v1 revenue source = Meta insights (matches ROAS denominator).
                Plan §2b footnote: may swap to Shopify daily_aggregates in W4/W5. */}
            <div className="text-[11px] text-text-3">приходи днес (Meta)</div>
          </div>
          <div>
            <div className="text-[15px] font-semibold text-text">
              ROAS {data.roasLast24h.toFixed(2)}
            </div>
            <div className="text-[11px] text-text-3">
              медиана 14д: {data.roasMedian14d.toFixed(2)}
            </div>
          </div>
        </div>

        <div className="self-end">
          <FreshnessDot lastSyncedAt={data.lastSyncedAt} />
        </div>
      </div>
    </div>
  );
}

function lastValue(arr: number[]): number {
  return arr.length === 0 ? 0 : arr[arr.length - 1];
}
