// Probe the Cvetita GR property (529025692) — does it have Google Ads
// data flowing in? Match the same query shape we use in production.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf-8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = loadEnv(resolve(process.cwd(), ".env.local"));
const GR_PROPERTY = "529025692";

async function token() {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GA4_CLIENT_ID,
      client_secret: env.GA4_CLIENT_SECRET,
      refresh_token: env.GA4_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const d = await r.json();
  return d.access_token;
}

const today = new Date().toISOString().slice(0, 10);
const thirtyAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

const t = await token();
console.log(`OAuth OK\n\n=== Probing GR property ${GR_PROPERTY} (last 30d) ===\n`);

// 1) Sanity check — basic traffic. If 0 sessions, property is empty/orphan.
const sessRes = await fetch(
  `https://analyticsdata.googleapis.com/v1beta/properties/${GR_PROPERTY}:runReport`,
  {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      dateRanges: [{ startDate: thirtyAgo, endDate: today }],
      metrics: [
        { name: "sessions" },
        { name: "totalUsers" },
        { name: "ecommercePurchases" },
        { name: "totalRevenue" },
      ],
    }),
  }
);
const sessData = await sessRes.json();
if (sessRes.ok) {
  const v = sessData.rows?.[0]?.metricValues || [];
  console.log(`  Overview:`);
  console.log(`    sessions:           ${v[0]?.value || 0}`);
  console.log(`    users:              ${v[1]?.value || 0}`);
  console.log(`    ecommercePurchases: ${v[2]?.value || 0}`);
  console.log(`    totalRevenue:       ${v[3]?.value || 0}`);
} else {
  console.log("  Sessions query error:", JSON.stringify(sessData, null, 2).slice(0, 500));
}

// 2) Google Ads — campaign breakdown with cost
console.log(`\n  Google Ads campaigns:`);
const adsRes = await fetch(
  `https://analyticsdata.googleapis.com/v1beta/properties/${GR_PROPERTY}:runReport`,
  {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      dateRanges: [{ startDate: thirtyAgo, endDate: today }],
      dimensions: [{ name: "sessionGoogleAdsCampaignName" }],
      metrics: [
        { name: "advertiserAdCost" },
        { name: "advertiserAdClicks" },
        { name: "ecommercePurchases" },
        { name: "totalRevenue" },
      ],
      orderBys: [{ metric: { metricName: "advertiserAdCost" }, desc: true }],
      limit: 25,
    }),
  }
);
const adsData = await adsRes.json();
if (adsRes.ok) {
  const rows = adsData.rows || [];
  if (rows.length === 0) {
    console.log("    No Google Ads campaign rows.");
  } else {
    let totalSpend = 0, totalRevenue = 0;
    for (const r of rows) {
      const name = r.dimensionValues?.[0]?.value || "(unknown)";
      const cost = parseFloat(r.metricValues?.[0]?.value || "0");
      const clicks = parseInt(r.metricValues?.[1]?.value || "0");
      const purchases = parseInt(r.metricValues?.[2]?.value || "0");
      const revenue = parseFloat(r.metricValues?.[3]?.value || "0");
      if (name === "(not set)" || (cost === 0 && clicks === 0)) continue;
      totalSpend += cost;
      totalRevenue += revenue;
      console.log(`    • ${name.padEnd(48)} spend ${cost.toFixed(2).padStart(8)} | clicks ${clicks.toString().padStart(5)} | purchases ${purchases.toString().padStart(3)} | revenue ${revenue.toFixed(2).padStart(8)}`);
    }
    console.log(`\n    TOTALS: spend ${totalSpend.toFixed(2)} EUR | revenue ${totalRevenue.toFixed(2)} EUR | ROAS ${totalSpend > 0 ? (totalRevenue / totalSpend).toFixed(2) : "n/a"}x`);
  }
} else {
  console.log("  Ads query error:", JSON.stringify(adsData, null, 2).slice(0, 500));
}

console.log("\n=== Probe complete ===\n");
