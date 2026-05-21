"use client";

import Link from "next/link";
import useSWR from "swr";
import {
  Area,
  AreaChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { ArrowRight } from "lucide-react";
import { Skeleton } from "@/components/shared/Skeleton";
import { FreshnessDot } from "@/components/shared/FreshnessDot";
import { fmtBgDate } from "@/lib/format";
import type { DatePreset } from "@/lib/dates";
import type { SeriesShape, SeriesKind } from "@/lib/series";

// ============================================================
// Types — mirror /api/dashboard/home/top-strip response shape.
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
  googleAds: {
    spend: TempoMetric;
    roas: { value: number };
    purchases: TempoMetric;
  } | null;
  crossPlatform: {
    cac: TempoMetric;
    netAfterAds: TempoMetric;
    channelMix: {
      meta: { revenue: number; pct: number };
      googleAds: { revenue: number; pct: number };
      mixed: { revenue: number; pct: number };
      other: { revenue: number; pct: number };
      shopifyRevenue: number;
    };
  };
  series: {
    business: { revenue: SeriesShape; orders: SeriesShape; aov: SeriesShape };
    ads: { spend: SeriesShape; roas: SeriesShape; attribution: SeriesShape };
    googleAds: { spend: SeriesShape; roas: SeriesShape; purchases: SeriesShape } | null;
    crossPlatform: { cac: SeriesShape; netAfterAds: SeriesShape };
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

const FEMININE_WEEKDAYS_BG = new Set(["сряда", "събота", "неделя"]);
function typicalAdjectiveBg(weekdayBg: string): string {
  return FEMININE_WEEKDAYS_BG.has(weekdayBg) ? "типична" : "типичен";
}

function fmtEur(n: number): string {
  return `${Math.round(n).toLocaleString("bg-BG")} EUR`;
}
function fmtEur2(n: number): string {
  return `${n.toLocaleString("bg-BG", { maximumFractionDigits: 2 })} EUR`;
}
function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("bg-BG");
}
function fmtRoas(n: number): string {
  return n.toFixed(2);
}
function fmtPctVal(n: number): string {
  return `${Math.round(n)}%`;
}

/**
 * Build the human label for a bucket index given the SeriesShape kind.
 *
 * - hourly: "14:00 — 14:59" (the literal Sofia clock window)
 * - daily:  "Пон, 21 май" (weekday + БГ short date — context for the value)
 * - weekly: "Седм. до пон, 21 май" (week-ending = "what the bucket holds")
 *
 * The weekday prefix matters more than it looks: in a 30d daily chart the
 * difference between Friday €1,200 (typical strong) and Tuesday €1,200
 * (well below typical) is the whole story, and the user shouldn't have
 * to count back on the calendar to know which day they're hovering.
 */
function formatBucketLabel(label: string, kind: SeriesKind): string {
  if (kind === "hourly") {
    const h = String(label).padStart(2, "0");
    const next = String((parseInt(label, 10) + 1) % 24).padStart(2, "0");
    return `${h}:00 — ${next}:00`;
  }
  const weekday = new Intl.DateTimeFormat("bg-BG", {
    weekday: "short",
  })
    .format(new Date(label))
    .replace(".", "");
  // БГ short weekday returns "пн"/"вт"/... — capitalise first letter for the
  // tooltip header so it doesn't read as a typo next to the date.
  const wd = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  if (kind === "weekly") return `Седм. до ${wd}, ${fmtBgDate(label)}`;
  return `${wd}, ${fmtBgDate(label)}`;
}

// ============================================================
// HeroCard — Stripe-style number + dual-line chart + drill link
// ============================================================
//
// Renders a SeriesShape into a 90px area chart with TWO traces:
//   * accent area  = `current` values (the answer for the selected window)
//   * grey line    = `comparison` values (typical day / prior period)
//
// In hourly mode the chart also gets a vertical "now" marker at nowIndex,
// and the current series is masked past nowIndex so the area doesn't
// extend into hours that haven't happened yet.
//
// Tooltip shows three rows: bucket label, current value, comparison value
// + delta. Delta math matches the headline TempoMetric arithmetic
// (matched-hour for hourly, equal-length-prior for daily/weekly).

interface HeroCardProps {
  label: string;
  value: string;
  vsTypical: number | null;
  typicalLabel: string;
  /** The new discriminated series. null → render value/delta only, no chart. */
  series: SeriesShape | null;
  hideDelta?: boolean;
  nullLabel?: string;
  inverseDelta?: boolean;
  subText?: string;
  drillTo?: { href: string; label: string };
  /**
   * How tooltip values should be formatted (EUR / x / int / %). Defaults
   * to plain БГ-locale number — pass `fmtEur` / `fmtRoas` etc. so the
   * tooltip reads in the same unit as the headline.
   */
  valueFormatter?: (n: number) => string;
}

interface ChartRow {
  i: number;
  label: string;
  current: number | null;
  comparison: number | null;
  partial: boolean;
}

function HeroCard({
  label,
  value,
  vsTypical,
  typicalLabel,
  series,
  hideDelta = false,
  nullLabel = "още рано",
  inverseDelta = false,
  subText,
  drillTo,
  valueFormatter,
}: HeroCardProps) {
  // Delta rendering — same triangle convention as before.
  let deltaNode: React.ReactNode = null;
  if (!hideDelta) {
    if (vsTypical === null) {
      deltaNode = <span className="text-text-3">{nullLabel}</span>;
    } else {
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
  }

  const chartRows = buildChartRows(series);
  const formatValue =
    valueFormatter ?? ((n: number) => n.toLocaleString("bg-BG", { maximumFractionDigits: 2 }));
  const seriesKind = series?.kind ?? "daily";

  const cardInner = (
    <>
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="text-[13px] font-semibold text-text">{label}</div>
        {drillTo && (
          <span className="inline-flex items-center gap-0.5 text-[11px] text-text-3 group-hover:text-text-2 transition-colors">
            {drillTo.label}
            <ArrowRight size={11} />
          </span>
        )}
      </div>
      <div className="text-[28px] md:text-[32px] font-bold tracking-tight text-text leading-none tabular-nums">
        {value}
      </div>
      {subText && (
        <div className="text-[11px] text-text-3 leading-tight mt-1">{subText}</div>
      )}
      {deltaNode && <div className="text-[12px] mt-1.5">{deltaNode}</div>}
      {chartRows && (
        <div className="h-[90px] -mx-2 mt-3">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartRows} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
              <defs>
                <linearGradient id="heroFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Tooltip
                // Recharts wraps `content` in its own div; we strip that
                // wrapper to a no-op so the glass container inside
                // TempoTooltip carries all the visual weight (otherwise
                // we'd be painting a glass card inside an opaque card).
                contentStyle={{
                  background: "transparent",
                  border: "none",
                  borderRadius: 0,
                  boxShadow: "none",
                  padding: 0,
                  outline: "none",
                }}
                wrapperStyle={{ outline: "none" }}
                cursor={{ stroke: "var(--text-3)", strokeWidth: 1, strokeDasharray: "2 2" }}
                content={(props) => (
                  <TempoTooltip
                    {...props}
                    seriesKind={seriesKind}
                    metricLabel={label}
                    formatValue={formatValue}
                    inverseDelta={inverseDelta}
                  />
                )}
              />
              {/* Comparison line — drawn FIRST so the accent area paints on top.
                  Stroke kept thin + dashed at 30% opacity to read as "context"
                  not data the user is reading. */}
              <Line
                type="monotone"
                dataKey="comparison"
                stroke="var(--text-3)"
                strokeWidth={1}
                strokeDasharray="3 3"
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
              <Area
                type="monotone"
                dataKey="current"
                stroke="var(--accent)"
                strokeWidth={1.5}
                fill="url(#heroFill)"
                isAnimationActive={false}
                dot={false}
                connectNulls={false}
              />
              {/* "Now" marker — only hourly today renders this. The
                  ReferenceLine sits at the last filled hour so the chart
                  endpoint visually marks "we are here". */}
              {series?.kind === "hourly" && series.nowIndex !== undefined && (
                <ReferenceLine
                  x={series.nowIndex}
                  stroke="var(--text-2)"
                  strokeDasharray="2 3"
                  strokeWidth={1}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </>
  );

  if (drillTo) {
    return (
      <Link
        href={drillTo.href}
        className="group bg-surface rounded-xl shadow-sm p-5 flex flex-col min-h-[220px] hover:shadow-md transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        {cardInner}
      </Link>
    );
  }
  return (
    <div className="bg-surface rounded-xl shadow-sm p-5 flex flex-col min-h-[220px]">
      {cardInner}
    </div>
  );
}

/**
 * Zip the SeriesShape into Recharts-friendly rows. For hourly mode, mask
 * current[h] = null past nowIndex so the area chart visibly stops at "now"
 * (the holding-value-forward done server-side is for the headline math,
 * not the chart — we want a clean drop-off at nowIndex).
 *
 * Returns null when the series can't draw (need ≥2 points).
 */
function buildChartRows(series: SeriesShape | null): ChartRow[] | null {
  if (!series || series.current.length < 2) return null;
  const rows: ChartRow[] = [];
  for (let i = 0; i < series.current.length; i++) {
    const isFuture =
      series.kind === "hourly" &&
      series.nowIndex !== undefined &&
      i > series.nowIndex;
    rows.push({
      i,
      label: series.labels[i] ?? String(i),
      current: isFuture ? null : series.current[i],
      comparison: series.comparison ? series.comparison[i] : null,
      partial: series.partial?.[i] ?? false,
    });
  }
  return rows;
}

// ============================================================
// Tooltip — glass container, header + label/value grid
// ============================================================
//
// Layout (visual sketch):
//
//   ┌───────────────────────────────┐
//   │ Пон, 19 май                    │  ← bucket header, text-text 12px
//   │ ─────────────────              │  ← 1px hairline (border-border)
//   │ Поръчки         65             │  ← label muted, value text-text bold
//   │ Типично         68    ▼ 4%     │  ← label muted, value muted, delta tone
//   └───────────────────────────────┘
//
// The container itself is `bg-surface/85 backdrop-blur-xl` — same glass
// vocabulary the TopBar, ToastProvider, Modal, and ads sticky toolbars
// already use across the platform. We strip Recharts' default wrapper
// (transparent, no border) so the glass card is the only painted layer.
//
// The two-column grid keeps "Типично" and "Поръчки" labels right-aligned
// to a single tab stop, so the eye can scan label → value without
// re-anchoring per row. Tabular-nums on the value column makes 65 and 68
// line up under each other even with different widths.

function TempoTooltip({
  active,
  payload,
  seriesKind,
  metricLabel,
  formatValue,
  inverseDelta,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: ChartRow }>;
  seriesKind: SeriesKind;
  /** The card's metric name — used as the row label for the current value. */
  metricLabel: string;
  formatValue: (n: number) => string;
  inverseDelta: boolean;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  const bucketLabel = formatBucketLabel(row.label, seriesKind);
  const cur = row.current;
  const cmp = row.comparison;

  let delta: { text: string; tone: "good" | "bad" | "flat" } | null = null;
  if (cur !== null && cmp !== null && cmp !== 0) {
    const pct = Math.round(((cur - cmp) / cmp) * 100);
    const isFlat = Math.abs(pct) < 1;
    const isGood = inverseDelta ? pct < -3 : pct > 3;
    const isBad = inverseDelta ? pct > 3 : pct < -3;
    const arrow = isFlat ? "—" : pct > 0 ? "▲" : "▼";
    delta = {
      text: `${arrow} ${Math.abs(pct)}%`,
      tone: isGood ? "good" : isBad ? "bad" : "flat",
    };
  }

  const toneColor =
    delta?.tone === "good"
      ? "text-accent"
      : delta?.tone === "bad"
        ? "text-red"
        : "text-text-3";

  return (
    <div
      className="
        bg-surface/85 backdrop-blur-xl
        border border-border/60 rounded-xl shadow-xl
        px-3 py-2.5 min-w-[180px]
        text-[11px] leading-tight
      "
    >
      <div className="flex items-baseline justify-between gap-2 text-text font-medium text-[11.5px]">
        <span>{bucketLabel}</span>
        {row.partial && (
          <span className="text-text-3 text-[10px] font-normal">частична</span>
        )}
      </div>
      <div className="h-px bg-border/70 my-1.5" />
      <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 items-baseline">
        {cur !== null && (
          <>
            <span className="text-text-3">{metricLabel}</span>
            <span className="text-text font-semibold tabular-nums text-right">
              {formatValue(cur)}
            </span>
          </>
        )}
        {cmp !== null && (
          <>
            <span className="text-text-3">Типично</span>
            <span className="text-text-2 tabular-nums text-right">
              <span>{formatValue(cmp)}</span>
              {delta && (
                <span className={`${toneColor} ml-2 tabular-nums`}>
                  {delta.text}
                </span>
              )}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================
// ChannelMix tile — unchanged behaviour from the previous file
// ============================================================

interface ChannelMixTileProps {
  meta: { revenue: number; pct: number };
  googleAds: { revenue: number; pct: number };
  mixed: { revenue: number; pct: number };
  other: { revenue: number; pct: number };
  shopifyRevenue: number;
}

const MIXED_STRIPE: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, var(--text-3) 0, var(--text-3) 4px, var(--text-2) 4px, var(--text-2) 8px)",
};

function ChannelMixTile({
  meta,
  googleAds,
  mixed,
  other,
  shopifyRevenue,
}: ChannelMixTileProps) {
  if (shopifyRevenue <= 0) {
    return (
      <div className="bg-surface rounded-xl shadow-sm p-5 min-h-[220px] flex flex-col gap-2">
        <div className="text-[13px] font-semibold text-text">Микс на каналите</div>
        <div className="text-[13px] text-text-3 mt-auto">няма Shopify приходи още</div>
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-xl shadow-sm p-5 min-h-[220px] flex flex-col gap-3">
      <div className="text-[13px] font-semibold text-text">Микс на каналите</div>
      <div className="flex h-3 rounded-full overflow-hidden bg-surface-2 gap-x-px">
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
          className="transition-all"
          style={{ width: `${mixed.pct}%`, ...MIXED_STRIPE }}
          title={`Смесена атрибуция: ${mixed.pct}%`}
        />
        <div
          className="bg-accent transition-all"
          style={{ width: `${other.pct}%` }}
          title={`Друго: ${other.pct}%`}
        />
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-3 text-[11px] mt-auto">
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
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={MIXED_STRIPE}
              aria-hidden
            />
            Смесена
          </div>
          <div className="text-[13px] font-semibold text-text tabular-nums">{mixed.pct}%</div>
          <div className="text-text-3 tabular-nums">{fmtEur(mixed.revenue)}</div>
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

function TileSkeleton({ hourly = false }: { hourly?: boolean }) {
  return (
    <div className="bg-surface rounded-xl shadow-sm p-5 min-h-[220px] flex flex-col">
      <Skeleton className="h-3 w-20 mb-3" />
      <Skeleton className="h-8 w-32 mb-2" />
      <Skeleton className="h-3 w-28 mb-4" />
      {hourly ? (
        // 24 thin bars hint at the upcoming hourly chart so the eye doesn't
        // flicker from "smooth area placeholder" to "spiky hourly trace".
        <div className="flex items-end gap-px h-[80px] mt-auto">
          {Array.from({ length: 24 }).map((_, i) => (
            <Skeleton key={i} className="flex-1" style={{ height: `${30 + (i % 5) * 12}%` }} />
          ))}
        </div>
      ) : (
        <Skeleton className="h-[80px] w-full mt-auto" />
      )}
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">{children}</div>
    </section>
  );
}

function LoadingStrip({
  title,
  description,
  hourly,
}: {
  title: string;
  description: string;
  hourly: boolean;
}) {
  return (
    <SectionShell title={title} description={description}>
      {Array.from({ length: 3 }).map((_, i) => (
        <TileSkeleton key={i} hourly={hourly} />
      ))}
    </SectionShell>
  );
}

// ============================================================
// KpiStrip — single fetch, multi-section render
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
  queryString: string;
  preset: DatePreset;
  rangeLabel: string;
}

export function KpiStrip({ queryString, preset, rangeLabel }: KpiStripProps) {
  const isToday = preset === "today";
  const isHourly = preset === "today" || preset === "yesterday";

  // 60s refresh for today (running totals change minute-by-minute); 5 min
  // for everything else.
  const refreshInterval = isToday ? 60_000 : 300_000;
  const { data, isLoading, error } = useSWR<TopStripResponse>(
    `/api/dashboard/home/top-strip?${queryString}`,
    fetcher,
    { refreshInterval, revalidateOnFocus: false }
  );

  // For today/yesterday the comparison baseline is the matched-hour average
  // across the last 4 same-weekdays; show that weekday in the delta label.
  // For range presets we compare to the equal-length preceding period.
  const baselineDate = isHourly
    ? preset === "today"
      ? new Date()
      : new Date(Date.now() - 86_400_000)
    : null;
  const weekdayBg = baselineDate ? sofiaWeekdayBg(baselineDate) : "";
  const typicalLabel = isHourly
    ? `${typicalAdjectiveBg(weekdayBg)} ${weekdayBg}`
    : "предходен период";

  const overallTitle = isToday
    ? "Общо днес"
    : preset === "yesterday"
      ? "Общо вчера"
      : `Общо — ${rangeLabel}`;
  const businessTitle = isToday
    ? "Бизнес днес"
    : preset === "yesterday"
      ? "Бизнес вчера"
      : `Бизнес — ${rangeLabel}`;
  const adsTitle = isToday
    ? "Meta днес"
    : preset === "yesterday"
      ? "Meta вчера"
      : `Meta — ${rangeLabel}`;
  const googleAdsTitle = isToday
    ? "Google Ads днес"
    : preset === "yesterday"
      ? "Google Ads вчера"
      : `Google Ads — ${rangeLabel}`;

  if (isLoading || !data) {
    return (
      <>
        <LoadingStrip title={overallTitle} description={OVERALL_DESC} hourly={isHourly} />
        <LoadingStrip title={businessTitle} description={BUSINESS_DESC} hourly={isHourly} />
        <LoadingStrip title={adsTitle} description={ADS_DESC} hourly={isHourly} />
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

  const { business, ads, googleAds, crossPlatform, series } = data;
  const businessDrill = { href: "/sales", label: "Виж продажби" };
  const adsDrill = { href: "/ads", label: "Виж реклами" };
  const googleAdsDrill = { href: "/google-ads", label: "Виж Google Ads" };

  // === Composability sub-text per tile ===
  const roasSub =
    ads.spend.value > 0
      ? `${fmtEur(ads.attribution.metaRevenue)} / ${fmtEur(ads.spend.value)}`
      : "няма spend днес";

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

  // Anomaly pill locked to today — see existing rationale in the route.
  const showAnomalyPill = isToday && data.anomalyCount > 0;

  // Range-mode tiles say "няма сравнение" when the previous-period
  // denominator is 0 — no time-of-day to wait for, just nothing to compare.
  const nullLabel = isHourly ? undefined : "няма сравнение";

  // Cross-platform sub-text — in hourly mode the chart can only render
  // Shopify − Meta (no hourly Google Ads source). The headline still uses
  // the full Meta + Google math, so the disclosure goes on the tile.
  const netAfterAdsSub = isHourly
    ? "Shopify − Meta − Google · кривата без Google днес"
    : "Shopify − Meta − Google разход";
  const cacSub = isHourly
    ? "(Meta + Google) / поръчки · кривата само Meta днес"
    : "(Meta + Google разход) / поръчки";

  return (
    <>
      <SectionShell title={overallTitle} description={OVERALL_DESC}>
        <HeroCard
          label="Цена за поръчка"
          value={fmtEur(crossPlatform.cac.value)}
          vsTypical={crossPlatform.cac.vsTypical}
          typicalLabel={typicalLabel}
          nullLabel={nullLabel}
          subText={cacSub}
          inverseDelta
          series={series.crossPlatform.cac}
          valueFormatter={fmtEur}
        />
        <HeroCard
          label="Нето след реклами"
          value={fmtEur(crossPlatform.netAfterAds.value)}
          vsTypical={crossPlatform.netAfterAds.vsTypical}
          typicalLabel={typicalLabel}
          nullLabel={nullLabel}
          subText={netAfterAdsSub}
          series={series.crossPlatform.netAfterAds}
          valueFormatter={fmtEur}
        />
        <ChannelMixTile
          meta={crossPlatform.channelMix.meta}
          googleAds={crossPlatform.channelMix.googleAds}
          mixed={crossPlatform.channelMix.mixed}
          other={crossPlatform.channelMix.other}
          shopifyRevenue={crossPlatform.channelMix.shopifyRevenue}
        />
      </SectionShell>

      <SectionShell title={businessTitle} description={BUSINESS_DESC}>
        <HeroCard
          label="Приходи"
          value={fmtEur(business.revenue.value)}
          vsTypical={business.revenue.vsTypical}
          typicalLabel={typicalLabel}
          nullLabel={nullLabel}
          series={series.business.revenue}
          valueFormatter={fmtEur}
          drillTo={businessDrill}
        />
        <HeroCard
          label="Поръчки"
          value={fmtInt(business.orders.value)}
          vsTypical={business.orders.vsTypical}
          typicalLabel={typicalLabel}
          nullLabel={nullLabel}
          series={series.business.orders}
          valueFormatter={fmtInt}
          drillTo={businessDrill}
        />
        <HeroCard
          label="Средна стойност"
          value={fmtEur2(business.aov.value)}
          vsTypical={null}
          typicalLabel={typicalLabel}
          hideDelta
          series={series.business.aov}
          valueFormatter={fmtEur2}
          drillTo={businessDrill}
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
        <HeroCard
          label="Разход"
          value={fmtEur(ads.spend.value)}
          vsTypical={ads.spend.vsTypical}
          typicalLabel={typicalLabel}
          nullLabel={nullLabel}
          series={series.ads.spend}
          valueFormatter={fmtEur}
          drillTo={adsDrill}
        />
        <HeroCard
          label="ROAS"
          value={fmtRoas(ads.roas.value)}
          subText={roasSub}
          vsTypical={null}
          typicalLabel={typicalLabel}
          hideDelta
          series={series.ads.roas}
          valueFormatter={fmtRoas}
          drillTo={adsDrill}
        />
        <HeroCard
          label="Атрибуция"
          value={attributionValue}
          subText={attributionSub}
          vsTypical={null}
          typicalLabel={typicalLabel}
          hideDelta
          series={series.ads.attribution}
          valueFormatter={fmtPctVal}
          drillTo={adsDrill}
        />
      </SectionShell>

      {googleAds && (
        <SectionShell title={googleAdsTitle} description={GOOGLE_ADS_DESC}>
          <HeroCard
            label="Разход"
            value={fmtEur(googleAds.spend.value)}
            vsTypical={googleAds.spend.vsTypical}
            typicalLabel={typicalLabel}
            nullLabel={nullLabel}
            series={series.googleAds?.spend ?? null}
            valueFormatter={fmtEur}
            drillTo={googleAdsDrill}
          />
          <HeroCard
            label="ROAS"
            value={fmtRoas(googleAds.roas.value)}
            vsTypical={null}
            typicalLabel={typicalLabel}
            hideDelta
            series={series.googleAds?.roas ?? null}
            valueFormatter={fmtRoas}
            drillTo={googleAdsDrill}
          />
          <HeroCard
            label="Покупки"
            value={fmtInt(googleAds.purchases.value)}
            vsTypical={googleAds.purchases.vsTypical}
            typicalLabel={typicalLabel}
            nullLabel={nullLabel}
            series={series.googleAds?.purchases ?? null}
            valueFormatter={fmtInt}
            drillTo={googleAdsDrill}
          />
        </SectionShell>
      )}
    </>
  );
}
