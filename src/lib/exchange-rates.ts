/**
 * Exchange-rate lookup for normalising shop-currency order totals to EUR.
 *
 * Source: ECB daily reference rates
 *   - Today           https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml
 *   - Last 90 days    https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml
 *   - Full history    https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml
 *
 * The ECB publishes around 16:00 CET on TARGET2 working days. Weekends and
 * holidays inherit the previous working day's rate. We mirror the same
 * behaviour by walking back up to 7 days when looking up a date.
 *
 * Storage: public.exchange_rates (rate_date, currency, rate_to_eur).
 * EUR itself is the identity (1.0) and never hits the network.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchWithTimeout } from "@/lib/fetch-utils";
import { logger } from "@/lib/logger";

const ECB_DAILY = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
const ECB_HIST_90D = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml";
const ECB_HIST_FULL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml";

const FETCH_TIMEOUT_MS = 8_000;
const MAX_LOOKBACK_DAYS = 7; // walk back across weekends/holidays

export interface DailyRates {
  date: string; // YYYY-MM-DD
  rates: Record<string, number>; // currency → units per 1 EUR
}

/**
 * Get the exchange rate to EUR for a given currency on a given date.
 * Returns 1.0 immediately for EUR. Falls back to the most recent rate within
 * MAX_LOOKBACK_DAYS for weekends/holidays. Throws if no rate is available.
 */
export async function getRateToEur(currency: string, date: Date): Promise<number> {
  const cur = currency.toUpperCase();
  if (cur === "EUR") return 1.0;

  const target = isoDate(date);

  // Try cache first: most recent rate at-or-before the target date
  const { data: cached, error: cachedErr } = await supabaseAdmin
    .from("exchange_rates")
    .select("rate_date, rate_to_eur")
    .eq("currency", cur)
    .lte("rate_date", target)
    .order("rate_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cachedErr) {
    logger.warn("exchange_rates cache lookup failed", { currency: cur, error: cachedErr.message });
  }

  if (cached) {
    const cachedDate = new Date(cached.rate_date);
    const ageDays = Math.floor((date.getTime() - cachedDate.getTime()) / 86_400_000);
    // Cached value is acceptable if it's within MAX_LOOKBACK_DAYS of target,
    // OR if target is in the future and we have any prior rate (the daily
    // cron will overwrite once ECB publishes).
    if (ageDays <= MAX_LOOKBACK_DAYS) return Number(cached.rate_to_eur);
  }

  // Cache miss / stale: refresh from ECB. Pick the cheapest source that
  // covers the requested date.
  const today = new Date();
  const ageFromToday = Math.floor((today.getTime() - date.getTime()) / 86_400_000);
  const sourceUrl = ageFromToday <= 1 ? ECB_DAILY : ageFromToday <= 90 ? ECB_HIST_90D : ECB_HIST_FULL;

  const days = await fetchEcbRates(sourceUrl);
  if (days.length === 0) {
    throw new Error(`ECB returned no rates from ${sourceUrl}`);
  }

  await persistRates(days);

  // Re-query: newest rate at-or-before target
  const match = days
    .filter((d) => d.date <= target)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];

  if (!match || match.rates[cur] === undefined) {
    throw new Error(`No ECB rate for ${cur} on or before ${target}`);
  }

  return match.rates[cur];
}

/**
 * Fetch and persist today's ECB rates. Idempotent — call from the daily cron.
 * Returns the number of (date, currency) rows upserted.
 */
export async function refreshDailyRates(): Promise<number> {
  const days = await fetchEcbRates(ECB_DAILY);
  return await persistRates(days);
}

/**
 * Fetch the last 90 days of ECB rates and persist. Used by backfill.
 */
export async function refresh90DayRates(): Promise<number> {
  const days = await fetchEcbRates(ECB_HIST_90D);
  return await persistRates(days);
}

// ============================================================
// Internals
// ============================================================

async function fetchEcbRates(url: string): Promise<DailyRates[]> {
  const res = await fetchWithTimeout(url, { headers: { Accept: "application/xml" } }, FETCH_TIMEOUT_MS);
  if (!res.ok) {
    throw new Error(`ECB returned ${res.status} for ${url}`);
  }
  const xml = await res.text();
  return parseEcbXml(xml);
}

/**
 * Parse the ECB envelope without an XML library. The format is stable
 * since 1999 and looks like:
 *   <Cube time="2026-05-07">
 *     <Cube currency="USD" rate="1.0834"/>
 *     <Cube currency="RON" rate="4.9755"/>
 *     ...
 *   </Cube>
 */
export function parseEcbXml(xml: string): DailyRates[] {
  const days: DailyRates[] = [];
  const dayRe = /<Cube\s+time="(\d{4}-\d{2}-\d{2})">([\s\S]*?)<\/Cube>/g;
  const rateRe = /<Cube\s+currency="([A-Z]{3})"\s+rate="([\d.]+)"\s*\/>/g;

  let dayMatch: RegExpExecArray | null;
  while ((dayMatch = dayRe.exec(xml)) !== null) {
    const date = dayMatch[1];
    const inner = dayMatch[2];
    const rates: Record<string, number> = {};
    let rateMatch: RegExpExecArray | null;
    while ((rateMatch = rateRe.exec(inner)) !== null) {
      const cur = rateMatch[1];
      const val = parseFloat(rateMatch[2]);
      if (Number.isFinite(val) && val > 0) rates[cur] = val;
    }
    if (Object.keys(rates).length > 0) {
      days.push({ date, rates });
    }
  }
  return days;
}

async function persistRates(days: DailyRates[]): Promise<number> {
  if (days.length === 0) return 0;
  const rows: { rate_date: string; currency: string; rate_to_eur: number; source: string }[] = [];
  for (const d of days) {
    for (const [currency, rate] of Object.entries(d.rates)) {
      rows.push({ rate_date: d.date, currency, rate_to_eur: rate, source: "ecb" });
    }
  }
  const { error } = await supabaseAdmin
    .from("exchange_rates")
    .upsert(rows, { onConflict: "rate_date,currency" });
  if (error) {
    throw new Error(`exchange_rates upsert failed: ${error.message}`);
  }
  return rows.length;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
