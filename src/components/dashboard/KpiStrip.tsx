"use client";

import useSWR from "swr";
import { Skeleton } from "@/components/shared/Skeleton";
import { FreshnessDot } from "@/components/shared/FreshnessDot";

// ============================================================
// Types (mirror /api/dashboard/home/top-strip response)
// ============================================================

interface TempoMetric {
  value: number;
  vsTypical: number | null;
  projected: number | null;
}

interface TopStripResponse {
  revenue: TempoMetric;
  spend: TempoMetric;
  orders: TempoMetric;
  roas: { value: number };
  anomalyCount: number;
  freshAsOf: string;
  error?: string;
}

// ============================================================
// Formatting helpers
// ============================================================

const SOFIA_TZ = "Europe/Sofia";

/** Bulgarian weekday noun in nominative case (e.g. "сряда"). */
function sofiaWeekdayBg(d: Date): string {
  return new Intl.DateTimeFormat("bg-BG", {
    timeZone: SOFIA_TZ,
    weekday: "long",
  }).format(d);
}

// Bulgarian adjectives agree in gender with the noun. Wed/Sat/Sun are
// feminine ("типична сряда"); the rest are masculine ("типичен понеделник").
const FEMININE_WEEKDAYS_BG = new Set(["сряда", "събота", "неделя"]);
function typicalAdjectiveBg(weekdayBg: string): string {
  return FEMININE_WEEKDAYS_BG.has(weekdayBg) ? "типична" : "типичен";
}

function fmtEur(n: number): string {
  return `${n.toLocaleString("bg-BG", {
    maximumFractionDigits: 0,
  })} EUR`;
}

function fmtInt(n: number): string {
  return n.toLocaleString("bg-BG", { maximumFractionDigits: 0 });
}

function fmtRoas(n: number): string {
  return n.toFixed(2);
}

// ============================================================
// Tile
// ============================================================

interface TileProps {
  label: string;
  value: string;
  vsTypical: number | null;
  projected: string | null;
  typicalLabel: string;
  /** Hide the delta/projected row entirely (e.g. ROAS — ratio, not cumulative). */
  hideDelta?: boolean;
}

function Tile({ label, value, vsTypical, projected, typicalLabel, hideDelta }: TileProps) {
  let deltaNode: React.ReactNode;
  if (hideDelta) {
    deltaNode = null;
  } else if (vsTypical === null) {
    deltaNode = <span className="text-text-3">още рано</span>;
  } else {
    const sign = vsTypical > 0 ? "+" : "";
    const color =
      vsTypical > 3
        ? "text-accent"
        : vsTypical < -3
          ? "text-red"
          : "text-text-2";
    deltaNode = (
      <span className={color}>
        {sign}
        {vsTypical}% vs {typicalLabel}
      </span>
    );
  }

  return (
    <div className="bg-surface rounded-xl shadow-sm p-5 flex flex-col gap-2 min-h-[120px]">
      <div className="text-[13px] font-semibold text-text">{label}</div>
      <div className="text-[28px] md:text-[32px] font-bold tracking-tight text-text leading-none">
        {value}
      </div>
      <div className="text-[12px] mt-auto flex flex-col gap-0.5">
        {deltaNode}
        {projected && (
          <span className="text-text-3">Прогноза за деня: {projected}</span>
        )}
      </div>
    </div>
  );
}

function TileSkeleton() {
  return (
    <div className="bg-surface rounded-xl shadow-sm p-5 min-h-[120px]">
      <Skeleton className="h-3 w-20 mb-3" />
      <Skeleton className="h-8 w-28 mb-2" />
      <Skeleton className="h-3 w-32" />
    </div>
  );
}

// ============================================================
// KpiStrip
// ============================================================

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function KpiStrip() {
  const { data, isLoading, error } = useSWR<TopStripResponse>(
    "/api/dashboard/home/top-strip",
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: false }
  );

  const weekdayBg = sofiaWeekdayBg(new Date());
  const typicalLabel = `${typicalAdjectiveBg(weekdayBg)} ${weekdayBg}`;

  if (isLoading || !data) {
    return (
      <section className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[15px] font-semibold text-text">Днешен ритъм</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <TileSkeleton key={i} />
          ))}
        </div>
      </section>
    );
  }

  if (error || data.error) {
    return (
      <section className="mb-6">
        <div className="bg-surface rounded-xl shadow-sm p-5 text-center text-[13px] text-text-2">
          Грешка при зареждане на дневния ритъм
        </div>
      </section>
    );
  }

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[15px] font-semibold text-text">Днешен ритъм</h2>
        <div className="flex items-center gap-3">
          {data.anomalyCount > 0 && (
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium bg-red-soft text-red animate-pulse"
              aria-label={`${data.anomalyCount} аномалии`}
            >
              <span className="inline-block h-2 w-2 rounded-full bg-red" />
              {data.anomalyCount} {data.anomalyCount === 1 ? "аномалия" : "аномалии"}
            </span>
          )}
          <FreshnessDot lastSyncedAt={data.freshAsOf} showLabel />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <Tile
          label="Приходи"
          value={fmtEur(data.revenue.value)}
          vsTypical={data.revenue.vsTypical}
          projected={data.revenue.projected !== null ? fmtEur(data.revenue.projected) : null}
          typicalLabel={typicalLabel}
        />
        <Tile
          label="Разход"
          value={fmtEur(data.spend.value)}
          vsTypical={data.spend.vsTypical}
          projected={data.spend.projected !== null ? fmtEur(data.spend.projected) : null}
          typicalLabel={typicalLabel}
        />
        <Tile
          label="ROAS"
          value={fmtRoas(data.roas.value)}
          vsTypical={null}
          projected={null}
          typicalLabel={typicalLabel}
          hideDelta
        />
        <Tile
          label="Поръчки"
          value={fmtInt(data.orders.value)}
          vsTypical={data.orders.vsTypical}
          projected={data.orders.projected !== null ? fmtInt(data.orders.projected) : null}
          typicalLabel={typicalLabel}
        />
      </div>
    </section>
  );
}
