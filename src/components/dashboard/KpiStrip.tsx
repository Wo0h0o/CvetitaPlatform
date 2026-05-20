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
  /**
   * Google Ads section — null when GA4 not configured / no data. UI hides
   * the SectionShell entirely in that case rather than rendering zeros.
   */
  googleAds: {
    spend: TempoMetric;
    roas: { value: number };
    purchases: TempoMetric;
  } | null;
  /**
   * Cross-platform composites. Each value combines Shopify + Meta + Google
   * — uniquely the platform's job to compute.
   */
  crossPlatform: {
    cac: TempoMetric;
    netAfterAds: TempoMetric;
    channelMix: {
      meta: { revenue: number; pct: number };
      googleAds: { revenue: number; pct: number };
      other: { revenue: number; pct: number };
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
  /**
   * Flip the colour logic for metrics where lower is better (CAC, bounce,
   * cost-per-thing). A positive vsTypical (going up) is then RED, not green.
   */
  inverseDelta?: boolean;
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
  inverseDelta = false,
}: TileProps) {
  let deltaNode: React.ReactNode;
  if (hideDelta) {
    deltaNode = null;
  } else if (vsTypical === null) {
    deltaNode = <span className="text-text-3">{nullLabel}</span>;
  } else {
    // Triangle glyphs match the analytics surface (see shared Delta.tsx,
    // design contract §4). ▲ for up, ▼ for down, em-dash within the noise
    // band so flat days don't claim a direction. ±3% threshold gates colour
    // because matched-hour pacing is noisier than period-to-period delta.
    const isFlat = Math.abs(vsTypical) < 1;
    const arrow = isFlat ? "—" : vsTypical > 0 ? "▲" : "▼";
    const isGood = inverseDelta ? vsTypical < -3 : vsTypical > 3;
    const isBad = inverseDelta ? vsTypical > 3 : vsTypical < -3;
    const color = isGood ? "text-accent" : isBad ? "text-red" : "text-text-2";
    deltaNode = (
      <span className={`${color} tabular-nums`}>
        <span className="text-[10px] align-middle mr-0.5">{arrow}</span>
        {Math.abs(vsTypical)}% vs {typicalLabel}
      </span>
    );
  }

  // `projected` is intentionally not rendered — user requested the deeper
  // tiles to free vertical space. The API still returns it; once we find a
  // surface where end-of-day forecast adds real value we can wire it back.
  void projected;

  return (
    <div className="bg-surface rounded-xl shadow-sm p-5 flex flex-col gap-2 min-h-[110px]">
      <div className="text-[13px] font-semibold text-text">{label}</div>
      <div className="text-[28px] md:text-[32px] font-bold tracking-tight text-text leading-none">
        {value}
      </div>
      {subText && (
        <div className="text-[11px] text-text-3 leading-tight">{subText}</div>
      )}
      <div className="text-[12px] mt-auto">{deltaNode}</div>
    </div>
  );
}

/**
 * ChannelMix tile — composition snapshot instead of a single hero number.
 * Three stacked horizontal segments (Meta · Google · Organic), each
 * proportional to its share of Shopify revenue. Below the bar: legend with
 * absolute EUR values for context.
 *
 * Per design contract §1 we resist category accent colours; here we use
 * accent only for the "Organic / друго" slice — that's the part the
 * operator's business KEEPS, and visually anchoring it as positive carries
 * meaning ("the bigger the green, the less you're paying for revenue").
 * Meta and Google use neutral greys at different opacities — distinguish
 * without colour-coding categories.
 */
interface ChannelMixTileProps {
  meta: { revenue: number; pct: number };
  googleAds: { revenue: number; pct: number };
  other: { revenue: number; pct: number };
  shopifyRevenue: number;
}

function ChannelMixTile({ meta, googleAds, other, shopifyRevenue }: ChannelMixTileProps) {
  if (shopifyRevenue <= 0) {
    return (
      <div className="bg-surface rounded-xl shadow-sm p-5 min-h-[120px] flex flex-col gap-2">
        <div className="text-[13px] font-semibold text-text">Микс на каналите</div>
        <div className="text-[13px] text-text-3 mt-auto">няма Shopify приходи още</div>
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-xl shadow-sm p-5 min-h-[120px] flex flex-col gap-3">
      <div className="text-[13px] font-semibold text-text">Микс на каналите</div>
      <div className="flex h-2 rounded-full overflow-hidden bg-surface-2">
        <div
          className="bg-text-3 transition-all"
          style={{ width: `${meta.pct}%` }}
          title={`Meta: ${meta.pct}%`}
        />
        <div
          className="bg-text-2 transition-all"
          style={{ width: `${googleAds.pct}%` }}
          title={`Google: ${googleAds.pct}%`}
        />
        <div
          className="bg-accent transition-all"
          style={{ width: `${other.pct}%` }}
          title={`Друго: ${other.pct}%`}
        />
      </div>
      <div className="grid grid-cols-3 gap-2 text-[11px] mt-auto">
        <div>
          <div className="flex items-center gap-1.5 text-text-2">
            <span className="inline-block h-2 w-2 rounded-full bg-text-3" />
            Meta
          </div>
          <div className="text-[13px] font-semibold text-text tabular-nums">{meta.pct}%</div>
          <div className="text-text-3 tabular-nums">{fmtEur(meta.revenue)}</div>
        </div>
        <div>
          <div className="flex items-center gap-1.5 text-text-2">
            <span className="inline-block h-2 w-2 rounded-full bg-text-2" />
            Google
          </div>
          <div className="text-[13px] font-semibold text-text tabular-nums">{googleAds.pct}%</div>
          <div className="text-text-3 tabular-nums">{fmtEur(googleAds.revenue)}</div>
        </div>
        <div>
          <div className="flex items-center gap-1.5 text-text-2">
            <span className="inline-block h-2 w-2 rounded-full bg-accent" />
            Друго
          </div>
          <div className="text-[13px] font-semibold text-text tabular-nums">{other.pct}%</div>
          <div className="text-text-3 tabular-nums">{fmtEur(other.revenue)}</div>
        </div>
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

const OVERALL_DESC =
  "Cross-platform композиции — числата, които никой един source не може да покаже сам.";
const BUSINESS_DESC =
  "Реалните продажби през Shopify — приходи, поръчки, средна стойност.";
const ADS_DESC =
  "Meta — разход, ROAS и каква част от бизнеса идва от платените канали.";
const GOOGLE_ADS_DESC =
  "Google Ads през GA4 — разход, ROAS и покупки (last-click attribution).";

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

  const overallTitle = isToday ? "Общо днес" : `Общо — ${rangeLabel}`;
  const businessTitle = isToday ? "Бизнес днес" : `Бизнес — ${rangeLabel}`;
  const adsTitle = isToday ? "Meta днес" : `Meta — ${rangeLabel}`;
  const googleAdsTitle = isToday ? "Google Ads днес" : `Google Ads — ${rangeLabel}`;

  if (isLoading || !data) {
    return (
      <>
        <LoadingStrip title={overallTitle} description={OVERALL_DESC} />
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

  const { business, ads, googleAds, crossPlatform } = data;

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
      <SectionShell title={overallTitle} description={OVERALL_DESC}>
        <Tile
          label="Цена за поръчка"
          value={fmtEur(crossPlatform.cac.value)}
          vsTypical={crossPlatform.cac.vsTypical}
          projected={
            crossPlatform.cac.projected !== null
              ? fmtEur(crossPlatform.cac.projected)
              : null
          }
          typicalLabel={typicalLabel}
          nullLabel={nullLabel}
          subText="(Meta + Google разход) / поръчки"
          inverseDelta
        />
        <Tile
          label="Нето след реклами"
          value={fmtEur(crossPlatform.netAfterAds.value)}
          vsTypical={crossPlatform.netAfterAds.vsTypical}
          projected={
            crossPlatform.netAfterAds.projected !== null
              ? fmtEur(crossPlatform.netAfterAds.projected)
              : null
          }
          typicalLabel={typicalLabel}
          nullLabel={nullLabel}
          subText="Shopify − Meta − Google разход"
        />
        <ChannelMixTile
          meta={crossPlatform.channelMix.meta}
          googleAds={crossPlatform.channelMix.googleAds}
          other={crossPlatform.channelMix.other}
          shopifyRevenue={crossPlatform.channelMix.shopifyRevenue}
        />
      </SectionShell>

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

      {googleAds && (
        <SectionShell title={googleAdsTitle} description={GOOGLE_ADS_DESC}>
          <Tile
            label="Разход"
            value={fmtEur(googleAds.spend.value)}
            vsTypical={googleAds.spend.vsTypical}
            projected={
              googleAds.spend.projected !== null
                ? fmtEur(googleAds.spend.projected)
                : null
            }
            typicalLabel={typicalLabel}
            nullLabel={nullLabel}
          />
          <Tile
            label="ROAS"
            value={fmtRoas(googleAds.roas.value)}
            vsTypical={null}
            projected={null}
            typicalLabel={typicalLabel}
            hideDelta
          />
          <Tile
            label="Покупки"
            value={fmtInt(googleAds.purchases.value)}
            vsTypical={googleAds.purchases.vsTypical}
            projected={
              googleAds.purchases.projected !== null
                ? fmtInt(googleAds.purchases.projected)
                : null
            }
            typicalLabel={typicalLabel}
            nullLabel={nullLabel}
          />
        </SectionShell>
      )}
    </>
  );
}
