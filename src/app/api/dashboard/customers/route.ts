import { NextResponse } from "next/server";
import { fetchOrdersWithCustomers } from "@/lib/shopify";
import type { CustomerOrder } from "@/lib/shopify";

export const maxDuration = 30;

function daysAgoStr(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function endOfToday(): string {
  const d = new Date();
  d.setUTCHours(23, 59, 59, 999);
  return d.toISOString();
}

// Week key: "2025-W12" format
function weekKey(dateStr: string): string {
  const d = new Date(dateStr);
  const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const dayOfYear = Math.floor((d.getTime() - jan1.getTime()) / 86400000) + 1;
  const weekNum = Math.ceil((dayOfYear + jan1.getUTCDay()) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

// Week label for display: "24 Feb"
function weekLabel(dateStr: string): string {
  const d = new Date(dateStr);
  // Find Monday of that week (UTC)
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
  return monday.toLocaleDateString("bg-BG", { day: "numeric", month: "short", timeZone: "UTC" });
}

function weeksBetween(dateA: string, dateB: string): number {
  const a = new Date(dateA);
  const b = new Date(dateB);
  return Math.floor((b.getTime() - a.getTime()) / (7 * 86400000));
}

interface CustomerData {
  id: number;
  orders: { created_at: string; total_price: number }[];
  firstOrderDate: string;
  totalSpent: number;
}

function buildCustomerMap(orders: CustomerOrder[]): Map<number, CustomerData> {
  const map = new Map<number, CustomerData>();

  for (const order of orders) {
    if (!order.customer?.id) continue;
    const cid = order.customer.id;
    const existing = map.get(cid);
    const price = parseFloat(order.total_price);

    if (existing) {
      existing.orders.push({ created_at: order.created_at, total_price: price });
      existing.totalSpent += price;
      if (order.created_at < existing.firstOrderDate) {
        existing.firstOrderDate = order.created_at;
      }
    } else {
      map.set(cid, {
        id: cid,
        orders: [{ created_at: order.created_at, total_price: price }],
        firstOrderDate: order.created_at,
        totalSpent: price,
      });
    }
  }

  // Sort each customer's orders chronologically
  for (const customer of map.values()) {
    customer.orders.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }

  return map;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const preset = searchParams.get("preset") || "90d";

  const presetDays: Record<string, number> = {
    "7d": 7, "30d": 30, "60d": 60, "90d": 90, "all": 180,
  };
  const days = presetDays[preset] || 90;

  try {
    const orders = await fetchOrdersWithCustomers(daysAgoStr(days), endOfToday());
    const customers = buildCustomerMap(orders);

    const totalCustomers = customers.size;
    if (totalCustomers === 0) {
      return NextResponse.json({
        summary: {
          totalCustomers: 0, newCustomers: 0, returningCustomers: 0,
          repeatPurchaseRate: 0, avgOrdersPerCustomer: 0,
          avgTimeTo2ndPurchase: null, revenuePerCustomer: 0,
        },
        newVsReturning: { newRevenue: 0, returningRevenue: 0, newPct: 0, returningPct: 0 },
        cohorts: [],
        secondPurchaseTiming: [],
      });
    }

    // ---- Summary metrics ----
    let newCustomers = 0;
    let returningCustomers = 0;
    let newRevenue = 0;
    let returningRevenue = 0;
    let totalOrders = 0;
    let totalRevenue = 0;
    const secondPurchaseDays: number[] = [];

    for (const c of customers.values()) {
      totalOrders += c.orders.length;
      totalRevenue += c.totalSpent;

      if (c.orders.length === 1) {
        newCustomers++;
        newRevenue += c.totalSpent;
      } else {
        returningCustomers++;
        returningRevenue += c.totalSpent;

        // Time to second purchase
        const first = new Date(c.orders[0].created_at).getTime();
        const second = new Date(c.orders[1].created_at).getTime();
        const daysDiff = Math.round((second - first) / 86400000);
        if (daysDiff >= 0) secondPurchaseDays.push(daysDiff);
      }
    }

    const repeatPurchaseRate = totalCustomers > 0 ? (returningCustomers / totalCustomers) * 100 : 0;
    const avgOrdersPerCustomer = totalCustomers > 0 ? totalOrders / totalCustomers : 0;
    const avgTimeTo2ndPurchase = secondPurchaseDays.length > 0
      ? secondPurchaseDays.reduce((s, d) => s + d, 0) / secondPurchaseDays.length
      : null;
    const revenuePerCustomer = totalCustomers > 0 ? totalRevenue / totalCustomers : 0;
    const totalRev = newRevenue + returningRevenue;

    // ---- Second purchase timing histogram (bucket by week) ----
    const timingBuckets: Record<string, number> = {};
    for (const d of secondPurchaseDays) {
      const weekBucket = `${Math.floor(d / 7) * 7}-${Math.floor(d / 7) * 7 + 6} дни`;
      timingBuckets[weekBucket] = (timingBuckets[weekBucket] || 0) + 1;
    }
    const secondPurchaseTiming = Object.entries(timingBuckets)
      .map(([bucket, count]) => ({ bucket, count }))
      .sort((a, b) => parseInt(a.bucket) - parseInt(b.bucket));

    // ---- Cohort retention table ----
    // Group customers by their first-purchase week
    const cohortMap = new Map<string, { customers: Set<number>; firstOrderDates: Map<number, string> }>();

    for (const c of customers.values()) {
      const wk = weekKey(c.firstOrderDate);
      const existing = cohortMap.get(wk) || { customers: new Set(), firstOrderDates: new Map() };
      existing.customers.add(c.id);
      existing.firstOrderDates.set(c.id, c.firstOrderDate);
      cohortMap.set(wk, existing);
    }

    // For each cohort, track which week offsets had returning customers
    const cohorts = Array.from(cohortMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([wk, cohortData]) => {
        const size = cohortData.customers.size;
        const retention: { week: number; customers: number; pct: number }[] = [];

        // Check weeks 1-8
        for (let weekOffset = 1; weekOffset <= 8; weekOffset++) {
          let returnedCount = 0;

          for (const cid of cohortData.customers) {
            const customer = customers.get(cid);
            if (!customer || customer.orders.length < 2) continue;

            const firstDate = cohortData.firstOrderDates.get(cid)!;

            // Check if any subsequent order falls in this week offset
            for (let oi = 1; oi < customer.orders.length; oi++) {
              const orderWeekOffset = weeksBetween(firstDate, customer.orders[oi].created_at);
              if (orderWeekOffset === weekOffset) {
                returnedCount++;
                break; // Count each customer once per week
              }
            }
          }

          retention.push({
            week: weekOffset,
            customers: returnedCount,
            pct: size > 0 ? Math.round((returnedCount / size) * 1000) / 10 : 0,
          });
        }

        // Find a representative date for the label
        const firstCustomerDate = Array.from(cohortData.firstOrderDates.values()).sort()[0];

        return {
          cohortWeek: wk,
          label: weekLabel(firstCustomerDate),
          size,
          retention,
        };
      });

    return NextResponse.json(
      {
        summary: {
          totalCustomers,
          newCustomers,
          returningCustomers,
          repeatPurchaseRate: Math.round(repeatPurchaseRate * 10) / 10,
          avgOrdersPerCustomer: Math.round(avgOrdersPerCustomer * 100) / 100,
          avgTimeTo2ndPurchase: avgTimeTo2ndPurchase !== null ? Math.round(avgTimeTo2ndPurchase) : null,
          revenuePerCustomer: Math.round(revenuePerCustomer * 100) / 100,
        },
        newVsReturning: {
          newRevenue: Math.round(newRevenue * 100) / 100,
          returningRevenue: Math.round(returningRevenue * 100) / 100,
          newPct: totalRev > 0 ? Math.round((newRevenue / totalRev) * 1000) / 10 : 0,
          returningPct: totalRev > 0 ? Math.round((returningRevenue / totalRev) * 1000) / 10 : 0,
        },
        cohorts,
        secondPurchaseTiming,
      },
      { headers: { "Cache-Control": "s-maxage=900, stale-while-revalidate=300" } }
    );
  } catch (error) {
    console.error("Customers API error:", error);
    return NextResponse.json({ error: "Customer data fetch failed" });
  }
}
