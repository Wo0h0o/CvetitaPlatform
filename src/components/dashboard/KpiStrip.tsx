"use client";

import useSWR from "swr";
import { Skeleton } from "@/components/shared/Skeleton";
import { FreshnessDot } from "@/components/shared/FreshnessDot";
import type { DatePreset } from "@/lib/dates";

// ============================================================
// Types — mirror /api/dashboard/home/top-strip response.
// Two source-pure sections: business (Shopify) and ads (Meta).
// ============================================================

interface TempoMetric {
  value: number;
  vsTypical: number | null;
  projected: number | null;
}

interface TopStripResponse {
  mode: "today" | "range";
  window: {
    from: string;
    to: string;
    preset: DatePreset;
    days: number;
  };
  business: {
    revenue: TempoMetric;
    orders: TempoMetric;
    aov: { value: number };
  };
  ads: {
    spend: TempoMetric;
    roas: { value: number };
    attribution: {
      pct: number | null;
      metaRevenue: number;
      shopifyRevenue: number;
    };
  };
  anomalyCount: number;
  freshAsOf: string;
  error?: string;
}

// ============================================================
// Formatting helpers
// ============================================================

const SOFIA_TZ = "Europe/Sofia";

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
  return `${n.toLocaleString("bg-BG", { maximumFractionDigits: 0 })} EUR`;
}

function fmtInt(n: number): string {
  return n.toLocaleString("bg-BG", { maximumFractionDigits: 0 });
}

function fmtRoas(n: number): string {
  return n.toFixed(2);
}

// ============================================================
// Tile — single metric, optional sub-text for composability hints.
// ============================================================

interface TileProps {
  label: string;
  value: string;
  vsTypical: number | null;
  projected: string | null;
  typicalLabel: string;
  /** Hide the delta/projected row entirely (e.g. ROAS — ratio, not cumulative). */
  hideDelta?: boolean;
  /**
   * Free-form small line directly under the value. Used for composability
   * hints (e.g. "428 EUR / 240 EUR" for ROAS, "428 от 794 EUR" for
   * attribution). Stays subtle so the primary number still leads the eye.
   */
  subText?: string;
  /**
   * Label shown when `vsTypical` is null. Defaults to "още рано" (today
   * pacing semantics — too early to project); range mode passes "няма
   * сравнение" because there's no time-of-day signal to wait for.
   */
  nullLabel?: string;
}

function Tile({
  label,
  value,
  vsTypical,
  projected,
  typicalLabel,
  hideDelta,
  subText,
  nullLabel = "още рано",
}: TileProps) {
  let deltaNode: React.ReactNode;
  if (hideDelta) {
    deltaNode = null;
  } else if (vsTypical === null) {
    deltaNode = <span className="text-text-3">{nullLabel}</span>;
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
      {subText && (
        <div className="text-[11px] text-text-3 leading-tight">{subText}</div>
      )}
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
// Sections
// ============================================================

interface SectionShellProps {
  title: string;
  description: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}

function SectionShell({ title, description, right, children }: SectionShellProps) {
  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-[15px] font-semibold text-text">{title}</h2>
        {right && <div className="flex items-center gap-3">{right}</div>}
      </div>
      <p className="text-[12px] text-text-3 mb-3">{description}</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
        {children}
      </div>
    </section>
  );
}

function LoadingStrip({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <SectionShell title={title} description={description}>
      {Array.from({ length: 3 }).map((_, i) => (
        <TileSkeleton key={i} />
      ))}
    </SectionShell>
  );
}

// ============================================================
// KpiStrip — orchestrates a single fetch then renders both sections.
// ============================================================

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const BUSINESS_DESC =
  "Реалните продажби през Shopify — приходи, поръчки, средна стойност.";
const ADS_DESC =
  "Meta — разход, ROAS и каква част от бизнеса идва от платените канали.";

interface KpiStripProps {
  /** Query string from useDateRange (e.g. "preset=today" or "preset=30d"). */
  queryString: string;
  /** Echoed preset — drives "today" vs "range" rendering. */
  preset: DatePreset;
  /** Human label for the active range (e.g. "Днес", "30 дни"). */
  rangeLabel: string;
}

export function KpiStrip({ queryString, preset, rangeLabel }: KpiStripProps) {
  const isToday = preset === "today";
  // 60s refresh for today (the running totals change minute-by-minute);
  // 5 min for historical ranges (today's row contributes <0.1% of a 30d
  // sum — no point hammering the edge cache).
  const refreshInterval = isToday ? 60_000 : 300_000;
  const { data, isLoading, error } = useSWR<TopStripResponse>(
    `/api/dashboard/home/top-strip?${queryString}`,
    fetcher,
    { refreshInterval, revalidateOnFocus: false }
  );

  // For today, comparison baseline is the matched-hour same-weekday
  // average; show that weekday in the delta label. For other ranges
  // we compare to the equal-length preceding period.
  const weekdayBg = sofiaWeekdayBg(new Date());
  const typicalLabel = isToday
    ? `${typicalAdjectiveBg(weekdayBg)} ${weekdayBg}`
    : "предходен период";

  const businessTitle = isToday ? "Бизнес днес" : `Бизнес — ${rangeLabel}`;
  const adsTitle = isToday ? "Реклами днес" : `Реклами — ${rangeLabel}`;

  if (isLoading || !data) {
    return (
      <>
        <LoadingStrip title={businessTitle} description={BUSINESS_DESC} />
        <LoadingStrip title={adsTitle} description={ADS_DESC} />
      </>
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

  const { business, ads } = data;

  // === Ads section trim text — composability hints ===
  // ROAS sub-text shows the two numbers it divides, so the operator can
  // verify the ratio at a glance.
  const roasSub =
    ads.spend.value > 0
      ? `${fmtEur(ads.attribution.metaRevenue)} / ${fmtEur(ads.spend.value)}`
      : "няма spend днес";

  // Attribution sub-text grounds the % in the absolute numbers it came
  // from. Bridges to business.revenue.
  //
  // Edge case: Meta credits a purchase before the Shopify webhook lands,
  // so metaRevenue can briefly exceed shopifyRevenue. Server clamps pct to
  // 100; we surface that with a "+" suffix and a short reason in subText
  // so the operator doesn't see "100% · 850 EUR от 794 EUR" — a number
  // pair that on its face contradicts the clamped pct.
  const overAttributed =
    ads.attribution.shopifyRevenue > 0 &&
    ads.attribution.metaRevenue > ads.attribution.shopifyRevenue;
  const attributionValue =
    ads.attribution.pct === null
      ? "—"
      : overAttributed
        ? `${ads.attribution.pct}%+`
        : `${ads.attribution.pct}%`;
  const attributionSub =
    ads.attribution.pct === null
      ? "няма Shopify приходи още"
      : overAttributed
        ? `${fmtEur(ads.attribution.metaRevenue)} vs ${fmtEur(ads.attribution.shopifyRevenue)} Shopify · Meta изпреварва`
        : `${fmtEur(ads.attribution.metaRevenue)} от ${fmtEur(ads.attribution.shopifyRevenue)} Shopify`;

  // Anomaly pill is locked to today's pending agent_briefs. In range
  // mode it would float under the "30 дни" header but mean "right now",
  // which reads wrong. Hide it; the operator still sees freshness via
  // the FreshnessDot.
  const showAnomalyPill = isToday && data.anomalyCount > 0;

  // Range-mode tiles show "няма сравнение" instead of "още рано" when
  // the previous-period denominator is 0 — no time-of-day signal to
  // wait for, just nothing to compare against.
  const nullLabel = isToday ? undefined : "няма сравнение";

  return (
    <>
      <SectionShell title={businessTitle} description={BUSINESS_DESC}>
        <Tile
          label="Приходи"
          value={fmtEur(business.revenue.value)}
          vsTypical={business.revenue.vsTypical}
          projected={
            business.revenue.projected !== null
              ? fmtEur(business.revenue.projected)
              : null
          }
          typicalLabel={typicalLabel}
          nullLabel={nullLabel}
        />
        <Tile
          label="Поръчки"
          value={fmtInt(business.orders.value)}
          vsTypical={business.orders.vsTypical}
          projected={
            business.orders.projected !== null
              ? fmtInt(business.orders.projected)
              : null
          }
          typicalLabel={typicalLabel}
          nullLabel={nullLabel}
        />
        <Tile
          label="Средна стойност"
          value={fmtEur(business.aov.value)}
          vsTypical={null}
          projected={null}
          typicalLabel={typicalLabel}
          hideDelta
        />
      </SectionShell>

      <SectionShell
        title={adsTitle}
        description={ADS_DESC}
        right={
          <>
            {showAnomalyPill && (
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium bg-red-soft text-red animate-pulse"
                aria-label={`${data.anomalyCount} аномалии`}
              >
                <span className="inline-block h-2 w-2 rounded-full bg-red" />
                {data.anomalyCount}{" "}
                {data.anomalyCount === 1 ? "аномалия" : "аномалии"}
              </span>
            )}
            <FreshnessDot lastSyncedAt={data.freshAsOf} showLabel />
          </>
        }
      >
        <Tile
          label="Разход"
          value={fmtEur(ads.spend.value)}
          vsTypical={ads.spend.vsTypical}
          projected={
            ads.spend.projected !== null ? fmtEur(ads.spend.projected) : null
          }
          typicalLabel={typicalLabel}
          nullLabel={nullLabel}
        />
        <Tile
          label="ROAS"
          value={fmtRoas(ads.roas.value)}
          subText={roasSub}
          vsTypical={null}
          projected={null}
          typicalLabel={typicalLabel}
          hideDelta
        />
        <Tile
          label="Атрибуция"
          value={attributionValue}
          subText={attributionSub}
          vsTypical={null}
          projected={null}
          typicalLabel={typicalLabel}
          hideDelta
        />
      </SectionShell>
    </>
  );
}
