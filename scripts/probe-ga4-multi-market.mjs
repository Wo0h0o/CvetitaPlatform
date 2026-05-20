// Probe whether our GA4 access reaches non-BG markets.
//
// Two checks:
//   1. Query the current GA4 property (348042832) with hostName dimension —
//      multi-host setup means all storefronts feed into one property and
//      we can filter per market.
//   2. List all GA4 properties our OAuth refresh token can read via the
//      Analytics Admin API — separate properties per market is the other
//      possible setup.
//
// Output drives the StoresTable expansion plan.

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
const propertyId = env.GA4_PROPERTY_ID;

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
console.log("OAuth OK\n");

// ============================================================
// CHECK 1: hostName breakdown in the current property
// ============================================================
console.log(`=== 1) hostName breakdown in property ${propertyId} (last 30d) ===\n`);

const hostRes = await fetch(
  `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
  {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      dateRanges: [{ startDate: thirtyAgo, endDate: today }],
      dimensions: [{ name: "hostName" }],
      metrics: [
        { name: "sessions" },
        { name: "advertiserAdCost" },
        { name: "ecommercePurchases" },
        { name: "totalRevenue" },
      ],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 50,
    }),
  }
);
const hostData = await hostRes.json();
if (hostRes.ok) {
  const rows = hostData.rows || [];
  if (rows.length === 0) {
    console.log("  No rows returned.");
  } else {
    console.log(`  Found ${rows.length} host(s):\n`);
    for (const row of rows) {
      const host = row.dimensionValues?.[0]?.value || "(unknown)";
      const sessions = parseInt(row.metricValues?.[0]?.value || "0");
      const cost = parseFloat(row.metricValues?.[1]?.value || "0");
      const purchases = parseInt(row.metricValues?.[2]?.value || "0");
      const revenue = parseFloat(row.metricValues?.[3]?.value || "0");
      console.log(`  • ${host.padEnd(32)} sessions ${sessions.toString().padStart(7)} | spend ${cost.toFixed(2).padStart(10)} EUR | purchases ${purchases.toString().padStart(5)} | revenue ${revenue.toFixed(2).padStart(10)} EUR`);
    }
  }
} else {
  console.log("  Error:", JSON.stringify(hostData, null, 2).slice(0, 500));
}

// ============================================================
// CHECK 2: list all properties accessible via OAuth (Admin API)
// ============================================================
console.log(`\n=== 2) Properties accessible via Admin API ===\n`);

const adminRes = await fetch(
  "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200",
  { headers: { Authorization: `Bearer ${t}` } }
);
const adminData = await adminRes.json();
if (adminRes.ok) {
  const accounts = adminData.accountSummaries || [];
  if (accounts.length === 0) {
    console.log("  No accounts visible (OAuth scope may not include Admin API).");
  } else {
    for (const acc of accounts) {
      console.log(`\n  Account: ${acc.displayName} (${acc.name})`);
      const props = acc.propertySummaries || [];
      if (props.length === 0) {
        console.log("    (no properties)");
        continue;
      }
      for (const p of props) {
        console.log(`    • ${p.displayName.padEnd(36)} ${p.property} ${p.propertyType ?? ""}`);
      }
    }
  }
} else {
  console.log("  Error:", JSON.stringify(adminData, null, 2).slice(0, 500));
}

console.log("\n=== Probe complete ===\n");
