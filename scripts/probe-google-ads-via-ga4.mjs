// Probe whether the GA4 property has Google Ads link active.
// Reads .env.local, refreshes OAuth, queries GA4 Data API for Google Ads
// metrics (advertiserAdCost, returnOnAdSpend) over the last 30 days.
//
// Usage: node scripts/probe-google-ads-via-ga4.mjs
//
// Output:
//   - Linkage status (active / not linked / partial)
//   - Per-campaign breakdown if data exists
//   - Totals + computed ROAS
//   - Hints if linkage missing

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv(path) {
  const lines = readFileSync(path, "utf-8").split(/\r?\n/);
  const out = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    out[key] = value;
  }
  return out;
}

const env = loadEnv(resolve(process.cwd(), ".env.local"));
const propertyId = env.GA4_PROPERTY_ID;
const clientId = env.GA4_CLIENT_ID;
const clientSecret = env.GA4_CLIENT_SECRET;
const refreshToken = env.GA4_REFRESH_TOKEN;

if (!propertyId || !clientId || !clientSecret || !refreshToken) {
  console.error("Missing GA4 credentials in .env.local");
  process.exit(1);
}

async function getAccessToken() {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`OAuth refresh failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

async function runReport(token, body) {
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const text = await res.text();
  if (!res.ok) return { error: `${res.status}: ${text.slice(0, 500)}` };
  return JSON.parse(text);
}

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().split("T")[0];
}

const startDate = daysAgo(30);
const endDate = daysAgo(0);

console.log(`\n=== GA4 → Google Ads probe ===`);
console.log(`Property: ${propertyId}`);
console.log(`Date range: ${startDate} → ${endDate}\n`);

const token = await getAccessToken();
console.log("✓ OAuth token refreshed\n");

// 1) Per-campaign breakdown — advertiserAdCost ALWAYS requires a dimension.
//    If GA4 is linked to Google Ads, sessionGoogleAdsCampaignName populates;
//    we sum rows to get totals.
console.log("--- 1) Google Ads campaigns (last 30d, sorted by spend) ---");
const campaignReport = await runReport(token, {
  dateRanges: [{ startDate, endDate }],
  dimensions: [{ name: "sessionGoogleAdsCampaignName" }],
  metrics: [
    { name: "advertiserAdCost" },
    { name: "advertiserAdClicks" },
    { name: "advertiserAdImpressions" },
    { name: "ecommercePurchases" },
    { name: "totalRevenue" },
  ],
  orderBys: [{ metric: { metricName: "advertiserAdCost" }, desc: true }],
  limit: 25,
});

if (campaignReport.error) {
  console.log(`  ❌ Error: ${campaignReport.error}`);
  const errStr = campaignReport.error.toLowerCase();
  if (errStr.includes("permission") || errStr.includes("not available") || errStr.includes("does not have")) {
    console.log(`\n  → Възможно е GA4 property да не е свързано с Google Ads.`);
    console.log(`  → Действие: GA4 admin → Property → Product Links → Google Ads → Link.`);
  }
  process.exit(0);
}

const rows = campaignReport.rows || [];
let totalCost = 0, totalClicks = 0, totalImpressions = 0, totalPurchases = 0, totalRevenue = 0;
let nonNullCampaigns = 0;

for (const row of rows) {
  const name = row.dimensionValues?.[0]?.value || "(not set)";
  const cost = parseFloat(row.metricValues?.[0]?.value || "0");
  const clicks = parseInt(row.metricValues?.[1]?.value || "0");
  const imps = parseInt(row.metricValues?.[2]?.value || "0");
  const purchases = parseInt(row.metricValues?.[3]?.value || "0");
  const revenue = parseFloat(row.metricValues?.[4]?.value || "0");
  totalCost += cost;
  totalClicks += clicks;
  totalImpressions += imps;
  totalPurchases += purchases;
  totalRevenue += revenue;
  if (name !== "(not set)" && name !== "" && cost > 0) nonNullCampaigns++;
  const roas = cost > 0 ? revenue / cost : 0;
  console.log(`  • ${name}`);
  console.log(`      spend ${cost.toFixed(2)} | clicks ${clicks} | impressions ${imps} | purchases ${purchases} | revenue ${revenue.toFixed(2)} | ROAS ${roas.toFixed(2)}x`);
}

console.log(`\n--- 2) Totals (last 30d) ---`);
console.log(`  Rows returned:        ${rows.length}`);
console.log(`  Campaigns with spend: ${nonNullCampaigns}`);
console.log(`  Total spend:          ${totalCost.toFixed(2)}`);
console.log(`  Total clicks:         ${totalClicks.toLocaleString()}`);
console.log(`  Total impressions:    ${totalImpressions.toLocaleString()}`);
console.log(`  Total purchases:      ${totalPurchases.toLocaleString()}`);
console.log(`  Total revenue:        ${totalRevenue.toFixed(2)}`);
console.log(`  Aggregate ROAS:       ${totalCost > 0 ? (totalRevenue / totalCost).toFixed(2) : "n/a"}x`);

const isLinked = totalCost > 0 || totalClicks > 0 || totalImpressions > 0;

if (!isLinked) {
  console.log(`\n  ⚠️  Всички Google Ads метрики са 0.`);
  console.log(`  Възможни причини:`);
  console.log(`    a) GA4 property не е link-нато с Google Ads акаунт (най-вероятно)`);
  console.log(`    b) Линк-ът съществува, но в последните 30 дни няма Google Ads spend`);
  console.log(`    c) Auto-tagging е изключено в Google Ads (Settings → Account → Auto-tagging)`);
  console.log(`\n  Действие: GA4 admin → Property → Product Links → Google Ads → Link.`);
  process.exit(0);
}

console.log(`\n  ✓ Линкът е активен — Google Ads данни флоу-ват в GA4.\n`);

// 3) Channel-level breakdown to confirm where "Paid Search" lives
console.log("\n--- 3) Channel split (last 30d, by sessions) ---");
const channelReport = await runReport(token, {
  dateRanges: [{ startDate, endDate }],
  dimensions: [{ name: "sessionDefaultChannelGroup" }],
  metrics: [{ name: "sessions" }, { name: "ecommercePurchases" }, { name: "totalRevenue" }],
  orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
  limit: 10,
});

if (channelReport.rows) {
  for (const row of channelReport.rows) {
    const ch = row.dimensionValues?.[0]?.value || "(unknown)";
    const sessions = parseInt(row.metricValues?.[0]?.value || "0");
    const purchases = parseInt(row.metricValues?.[1]?.value || "0");
    const revenue = parseFloat(row.metricValues?.[2]?.value || "0");
    console.log(`  • ${ch.padEnd(20)} sessions ${sessions.toString().padStart(7)} | purchases ${purchases.toString().padStart(5)} | revenue ${revenue.toFixed(2)}`);
  }
}

console.log(`\n=== Probe complete ===\n`);
