import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { requireAuth } from "@/lib/api-auth";
import {
  getDateRange,
  type DatePreset,
  sofiaToday,
  addDays,
  daysInRange,
  countWeekdaysInRange,
} from "@/lib/dates";
import { runReport, isGA4Configured, type GA4Row } from "@/lib/ga4";

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  if (!isGA4Configured()) {
    return NextResponse.json({ error: "GA4 not configured" }, { status: 200 });
  }

  try {
    const preset = (req.nextUrl.searchParams.get("preset") || "30d") as DatePreset;
    const customFrom = req.nextUrl.searchParams.get("from") || undefined;
    const customTo = req.nextUrl.searchParams.get("to") || undefined;
    const range = getDateRange(preset, customFrom, customTo);
    const start = range.from;
    const end = range.to;

    // Rhythm window — the hour×weekday view presents per-weekday
    // AVERAGES, so a partial current day (counted as a whole occurrence)
    // dilutes every average it touches (design contract §12). Drop today
    // when the range ends on it; the numerator fetch and the weekday
    // divisors below both span this clamped window in lockstep.
    const rhythmEnd = end === sofiaToday() ? addDays(end, -1) : end;
    const rhythmValid = daysInRange(start, rhythmEnd) >= 2;

    const overviewMetrics = ["sessions", "totalUsers", "engagementRate", "keyEvents", "ecommercePurchases"];
    // Standard GA4 e-commerce event names — the dataLayer on cvetitaherbal.com
    // sends these via Shopify's GA4 integration. If a store doesn't track them,
    // the UI renders an empty state explaining what's missing.
    const FUNNEL_EVENTS = ["view_item", "add_to_cart", "begin_checkout", "purchase"];
    const funnelFilter = {
      filter: { fieldName: "eventName", inListFilter: { values: FUNNEL_EVENTS } },
    };

    const [
      channelRows,
      sourceMediumRows,
      pageRows,
      deviceRows,
      overviewRows,
      prevOverviewRows,
      funnelRows,
      prevFunnelRows,
      topEventsRows,
      prevTopEventsRows,
      dailyRows,
      rhythmRows,
      geoRows,
    ] = await Promise.all([
      // Channel Group — coarse aggregation (Organic Search / Paid Search /
      // Direct / Referral / ...). Kept because agent-context.ts feeds it
      // into AI prompts as an executive summary; changing the shape would
      // break every downstream agent that consumes business context.
      runReport({
        metrics: ["sessions", "totalUsers", "engagementRate"],
        dimensions: ["sessionDefaultChannelGroup"],
        startDate: start, endDate: end, limit: 8,
      }),
      // sessionSourceMedium — granular acquisition source (google/organic vs
      // google/cpc vs bing/organic). This is what the /traffic UI renders.
      runReport({
        metrics: ["sessions", "totalUsers", "engagementRate", "ecommercePurchases"],
        dimensions: ["sessionSourceMedium"],
        startDate: start, endDate: end, limit: 12,
      }),
      runReport({
        metrics: ["sessions", "engagementRate", "keyEvents"],
        dimensions: ["pagePath"],
        startDate: start, endDate: end, limit: 10,
      }),
      runReport({
        metrics: ["sessions", "totalUsers"],
        dimensions: ["deviceCategory"],
        startDate: start, endDate: end,
      }),
      runReport({ metrics: overviewMetrics, startDate: start, endDate: end }),
      runReport({ metrics: overviewMetrics, startDate: range.compFrom, endDate: range.compTo }),
      runReport({
        metrics: ["eventCount"],
        dimensions: ["eventName"],
        startDate: start, endDate: end,
        dimensionFilter: funnelFilter,
      }),
      runReport({
        metrics: ["eventCount"],
        dimensions: ["eventName"],
        startDate: range.compFrom, endDate: range.compTo,
        dimensionFilter: funnelFilter,
      }),
      runReport({
        metrics: ["eventCount", "totalUsers"],
        dimensions: ["eventName"],
        startDate: start, endDate: end, limit: 10,
      }),
      runReport({
        metrics: ["eventCount"],
        dimensions: ["eventName"],
        startDate: range.compFrom, endDate: range.compTo, limit: 50,
      }),
      // Daily time series — feeds the hero-strip sparklines. Same 5 overview
      // metrics, broken down by date so each MiniKpi can render its own trend.
      runReport({ metrics: overviewMetrics, dimensions: ["date"], startDate: start, endDate: end }),
      // Rhythm — sessions split by weekday × hour. Skipped (empty) when the
      // complete-days window is too short for a meaningful pattern.
      rhythmValid
        ? runReport({
            metrics: ["sessions"],
            dimensions: ["dayOfWeek", "hour"],
            startDate: start, endDate: rhythmEnd,
          })
        : Promise.resolve([] as GA4Row[]),
      // Geo — sessions by country (ISO alpha-2 via countryId). Top 12
      // covers the long tail; the UI renders a ranked bar breakdown.
      runReport({
        metrics: ["sessions", "totalUsers"],
        dimensions: ["countryId"],
        startDate: start, endDate: end, limit: 12,
      }),
    ]);

    // Channel Group (kept for agent-context.ts backward compat).
    const channels = channelRows.map((r) => ({
      channel: r.dimensionValues?.[0]?.value || "Unknown",
      sessions: parseInt(r.metricValues?.[0]?.value || "0"),
      users: parseInt(r.metricValues?.[1]?.value || "0"),
      engagementRate: parseFloat(r.metricValues?.[2]?.value || "0"),
    }));

    // Source/Medium rows keep both the raw GA4 value (e.g. "google / organic")
    // and parsed source+medium fields so the UI can render whichever fits.
    const sourceMedium = sourceMediumRows.map((r) => {
      const raw = r.dimensionValues?.[0]?.value || "(direct) / (none)";
      const [source = "", medium = ""] = raw.split(" / ");
      return {
        sourceMedium: raw,
        source,
        medium,
        sessions: parseInt(r.metricValues?.[0]?.value || "0"),
        users: parseInt(r.metricValues?.[1]?.value || "0"),
        engagementRate: parseFloat(r.metricValues?.[2]?.value || "0"),
        purchases: parseInt(r.metricValues?.[3]?.value || "0"),
      };
    });

    const topPages = pageRows.map((r) => ({
      page: r.dimensionValues?.[0]?.value || "/",
      sessions: parseInt(r.metricValues?.[0]?.value || "0"),
      engagementRate: parseFloat(r.metricValues?.[1]?.value || "0"),
      conversions: parseInt(r.metricValues?.[2]?.value || "0"),
    }));

    const devices = deviceRows.map((r) => ({
      device: r.dimensionValues?.[0]?.value || "Unknown",
      sessions: parseInt(r.metricValues?.[0]?.value || "0"),
      users: parseInt(r.metricValues?.[1]?.value || "0"),
    }));

    const parseOverview = (rows: GA4Row[]) => {
      const v = rows[0]?.metricValues || [];
      return {
        sessions: parseInt(v[0]?.value || "0"),
        users: parseInt(v[1]?.value || "0"),
        engagementRate: parseFloat(v[2]?.value || "0"),
        conversions: parseInt(v[3]?.value || "0"),
        purchases: parseInt(v[4]?.value || "0"),
      };
    };
    const overview = parseOverview(overviewRows);
    const previousOverview = parseOverview(prevOverviewRows);

    // Funnel: collapse the filtered event rows into a {event_name: count}
    // map so the UI can render steps in a fixed display order regardless of
    // how GA4 sorted them. Missing events default to 0 (handled in UI).
    const rowsToMap = (rows: GA4Row[]): Record<string, number> => {
      const m: Record<string, number> = {};
      for (const r of rows) {
        const name = r.dimensionValues?.[0]?.value;
        if (name) m[name] = parseInt(r.metricValues?.[0]?.value || "0");
      }
      return m;
    };
    const funnel = rowsToMap(funnelRows);
    const previousFunnel = rowsToMap(prevFunnelRows);

    // Top events list + previous-period lookup map (top 50 covers shifts).
    const topEvents = topEventsRows.map((r) => ({
      name: r.dimensionValues?.[0]?.value || "unknown",
      count: parseInt(r.metricValues?.[0]?.value || "0"),
      users: parseInt(r.metricValues?.[1]?.value || "0"),
    }));
    const previousTopEvents = rowsToMap(prevTopEventsRows);

    // Daily time series. GA4's `date` dimension comes back as "YYYYMMDD"
    // strings; we sort asc so the sparkline reads left-to-right.
    const dailyOverview = dailyRows
      .map((r) => ({
        date: r.dimensionValues?.[0]?.value || "",
        sessions: parseInt(r.metricValues?.[0]?.value || "0"),
        users: parseInt(r.metricValues?.[1]?.value || "0"),
        engagementRate: parseFloat(r.metricValues?.[2]?.value || "0"),
        conversions: parseInt(r.metricValues?.[3]?.value || "0"),
        purchases: parseInt(r.metricValues?.[4]?.value || "0"),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Rhythm — sessions by ISO weekday (1=Mon..7=Sun) × hour, averaged per
    // occurrence. GA4's dayOfWeek is 0-6 with 0=Sunday; remap to ISO. The
    // weekday counts double as the tooltip's "средно от N" divisor.
    const rhythmWeekdayCounts = countWeekdaysInRange(start, rhythmEnd);
    const rhythm = rhythmRows.map((r) => {
      const ga4Wd = parseInt(r.dimensionValues?.[0]?.value || "0", 10);
      const weekday = ga4Wd === 0 ? 7 : ga4Wd;
      const hour = parseInt(r.dimensionValues?.[1]?.value || "0", 10);
      const sessions = parseInt(r.metricValues?.[0]?.value || "0", 10);
      const occ = rhythmWeekdayCounts.get(weekday) ?? 0;
      return { weekday, hour, sessions, avgSessions: occ > 0 ? sessions / occ : 0 };
    });
    const rhythmMeta = {
      from: start,
      to: rhythmEnd,
      valid: rhythmValid,
      weekdayCounts: Object.fromEntries(rhythmWeekdayCounts),
    };

    // Geo — countryId is the ISO alpha-2 code (caps). "(not set)" rows
    // (GA4's unresolved-geo bucket) keep their raw value so the UI can
    // label them honestly rather than silently dropping sessions.
    const geo = geoRows
      .map((r) => ({
        country: r.dimensionValues?.[0]?.value || "(not set)",
        sessions: parseInt(r.metricValues?.[0]?.value || "0", 10),
        users: parseInt(r.metricValues?.[1]?.value || "0", 10),
      }))
      .sort((a, b) => b.sessions - a.sessions);

    return NextResponse.json(
      {
        period: range.label,
        compare: { from: range.compFrom, to: range.compTo, label: "пр. период" },
        overview,
        previousOverview,
        channels,
        sourceMedium,
        topPages,
        devices,
        funnel,
        previousFunnel,
        topEvents,
        previousTopEvents,
        dailyOverview,
        rhythm,
        rhythmMeta,
        geo,
      },
      { headers: { "Cache-Control": "s-maxage=900, stale-while-revalidate=300" } }
    );
  } catch (error) {
    logger.error("Traffic API error", { error: String(error) });
    return NextResponse.json({ error: "GA4 fetch failed" }, { status: 500 });
  }
}
