// Fetches real business data and formats it as context for AI agents
// This is injected into every agent's system prompt automatically
import { fetchWithTimeout } from "./fetch-utils";

interface BusinessContext {
  shopify: {
    salesToday: number;
    ordersToday: number;
    aov: number;
    topProducts: { title: string; quantity: number; revenue: number }[];
  } | null;
  ga4: {
    overview: {
      sessions: number;
      users: number;
      engagementRate: number;
      conversions: number;
      purchases: number;
    };
    channels: { channel: string; sessions: number }[];
    topPages: { page: string; sessions: number; conversions: number }[];
    devices: { device: string; sessions: number }[];
  } | null;
  klaviyo: {
    totalRevenue: number;
    campaignRevenue: number;
    flowRevenue: number;
    totalEmails: number;
    avgOpenRate: number;
    avgClickRate: number;
    activeFlows: number;
    totalFlows: number;
    topFlows: { name: string; revenue: number; openRate: number; clickRate: number }[];
  } | null;
  meta: {
    overview: {
      spend: number;
      revenue: number;
      roas: number;
      purchases: number;
      cpa: number;
      ctr: number;
    };
    campaigns: { name: string; spend: number; revenue: number; roas: number; purchases: number }[];
    funnel: {
      impressions: number;
      linkClicks: number;
      landingPageViews: number;
      addToCart: number;
      initiateCheckout: number;
      purchases: number;
    };
  } | null;
  customers: {
    totalCustomers: number;
    newCustomers: number;
    returningCustomers: number;
    repeatPurchaseRate: number;
    avgTimeTo2ndPurchase: number | null;
    revenuePerCustomer: number;
  } | null;
}

export async function fetchBusinessContext(
  baseUrl: string,
  options?: { shopifyDay?: "yesterday"; cookie?: string }
): Promise<BusinessContext> {
  const dayParam = options?.shopifyDay === "yesterday" ? "?day=yesterday" : "";
  const headers: Record<string, string> = {};
  if (options?.cookie) headers.cookie = options.cookie;

  const f = (url: string) => fetchWithTimeout(url, { headers }, 8_000).then((r) => r.json()).catch(() => null);
  const results = await Promise.allSettled([
    f(`${baseUrl}/api/dashboard/kpis${dayParam}`),
    f(`${baseUrl}/api/dashboard/top-products${dayParam}`),
    f(`${baseUrl}/api/dashboard/email?preset=30d`),
    f(`${baseUrl}/api/dashboard/traffic`),
    f(`${baseUrl}/api/dashboard/ads?preset=7d`),
    f(`${baseUrl}/api/dashboard/customers?preset=90d`),
  ]);

  const kpis = results[0].status === "fulfilled" ? results[0].value : null;
  const products = results[1].status === "fulfilled" ? results[1].value : null;
  const email = results[2].status === "fulfilled" ? results[2].value : null;
  const traffic = results[3].status === "fulfilled" ? results[3].value : null;
  const ads = results[4].status === "fulfilled" ? results[4].value : null;
  const custData = results[5].status === "fulfilled" ? results[5].value : null;

  return {
    shopify: kpis
      ? {
          salesToday: kpis.sales?.value ?? 0,
          ordersToday: kpis.orders?.value ?? 0,
          aov: kpis.aov?.value ?? 0,
          topProducts: Array.isArray(products) ? products.slice(0, 5) : [],
        }
      : null,

    ga4: traffic && !traffic.error
      ? {
          overview: {
            sessions: traffic.overview?.sessions ?? 0,
            users: traffic.overview?.users ?? 0,
            engagementRate: traffic.overview?.engagementRate ?? 0,
            conversions: traffic.overview?.conversions ?? 0,
            purchases: traffic.overview?.purchases ?? 0,
          },
          channels: (traffic.channels || []).slice(0, 5).map((c: { channel: string; sessions: number }) => ({
            channel: c.channel,
            sessions: c.sessions,
          })),
          topPages: (traffic.topPages || []).slice(0, 5).map((p: { page: string; sessions: number; conversions: number }) => ({
            page: p.page,
            sessions: p.sessions,
            conversions: p.conversions,
          })),
          devices: (traffic.devices || []).map((d: { device: string; sessions: number }) => ({
            device: d.device,
            sessions: d.sessions,
          })),
        }
      : kpis
        ? {
            overview: { sessions: kpis.sessions?.value ?? 0, users: 0, engagementRate: 0, conversions: 0, purchases: 0 },
            channels: [],
            topPages: [],
            devices: [],
          }
        : null,

    klaviyo: email && !email.error
      ? {
          totalRevenue: email.totalRevenue ?? 0,
          campaignRevenue: email.campaignRevenue ?? 0,
          flowRevenue: email.flowRevenue ?? 0,
          totalEmails: email.totalEmails ?? 0,
          avgOpenRate: email.avgOpenRate ?? 0,
          avgClickRate: email.avgClickRate ?? 0,
          activeFlows: email.activeFlows ?? 0,
          totalFlows: email.totalFlows ?? 0,
          topFlows: (email.topFlows || []).slice(0, 3).map((f: { name: string; revenue: number; openRate: number; clickRate: number }) => ({
            name: f.name,
            revenue: f.revenue,
            openRate: f.openRate,
            clickRate: f.clickRate,
          })),
        }
      : null,

    meta: ads && !ads.error
      ? {
          overview: {
            spend: ads.overview?.spend ?? 0,
            revenue: ads.overview?.revenue ?? 0,
            roas: ads.overview?.roas ?? 0,
            purchases: ads.overview?.purchases ?? 0,
            cpa: ads.overview?.cpa ?? 0,
            ctr: ads.overview?.ctr ?? 0,
          },
          campaigns: (ads.campaigns || []).slice(0, 5).map((c: { name: string; spend: number; revenue: number; roas: number; purchases: number }) => ({
            name: c.name,
            spend: c.spend,
            revenue: c.revenue,
            roas: c.roas,
            purchases: c.purchases,
          })),
          funnel: {
            impressions: ads.overview?.impressions ?? 0,
            linkClicks: ads.overview?.linkClicks ?? 0,
            landingPageViews: ads.overview?.landingPageViews ?? 0,
            addToCart: ads.overview?.addToCart ?? 0,
            initiateCheckout: ads.overview?.initiateCheckout ?? 0,
            purchases: ads.overview?.purchases ?? 0,
          },
        }
      : null,

    customers: custData && !custData.error && custData.summary
      ? {
          totalCustomers: custData.summary.totalCustomers ?? 0,
          newCustomers: custData.summary.newCustomers ?? 0,
          returningCustomers: custData.summary.returningCustomers ?? 0,
          repeatPurchaseRate: custData.summary.repeatPurchaseRate ?? 0,
          avgTimeTo2ndPurchase: custData.summary.avgTimeTo2ndPurchase ?? null,
          revenuePerCustomer: custData.summary.revenuePerCustomer ?? 0,
        }
      : null,
  };
}

function fmtNum(n: number, decimals = 2): string {
  return n.toLocaleString("bg-BG", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("bg-BG");
}

function fmtPct(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

export function formatContextForPrompt(ctx: BusinessContext, options?: { shopifyLabel?: string }): string {
  const shopifyLabel = options?.shopifyLabel || "продажби днес";
  const lines: string[] = ["=== АКТУАЛНИ БИЗНЕС ДАННИ ===", ""];

  // ---- Shopify ----
  if (ctx.shopify) {
    lines.push(`SHOPIFY (${shopifyLabel}):`);
    lines.push(`  Приходи: ${fmtNum(ctx.shopify.salesToday)} EUR`);
    lines.push(`  Поръчки: ${ctx.shopify.ordersToday}`);
    lines.push(`  Среден чек (AOV): ${fmtNum(ctx.shopify.aov)} EUR`);
    if (ctx.shopify.topProducts.length > 0) {
      lines.push(`  Топ продукти (${shopifyLabel}):`);
      ctx.shopify.topProducts.forEach((p) => {
        lines.push(`    - ${p.title}: ${p.quantity} бр. / ${fmtNum(p.revenue)} EUR`);
      });
    }
    lines.push("");
  }

  // ---- Meta Ads ----
  if (ctx.meta) {
    const m = ctx.meta.overview;
    lines.push("META ADS (последните 7 дни):");
    lines.push(`  Spend: ${fmtNum(m.spend)} EUR | Revenue: ${fmtNum(m.revenue)} EUR | ROAS: ${fmtNum(m.roas)}x`);
    lines.push(`  Покупки: ${fmtInt(m.purchases)} | CPA: ${fmtNum(m.cpa)} EUR | CTR: ${fmtNum(m.ctr)}%`);

    if (ctx.meta.campaigns.length > 0) {
      lines.push("  Топ кампании:");
      ctx.meta.campaigns.forEach((c) => {
        lines.push(`    - ${c.name}: spend ${fmtNum(c.spend)} EUR, revenue ${fmtNum(c.revenue)} EUR, ROAS ${fmtNum(c.roas)}x, ${fmtInt(c.purchases)} покупки`);
      });
    }

    const f = ctx.meta.funnel;
    lines.push("  Рекламна фуния:");
    lines.push(`    Impressions ${fmtInt(f.impressions)} → Link Clicks ${fmtInt(f.linkClicks)} → Landing Pages ${fmtInt(f.landingPageViews)} → Add to Cart ${fmtInt(f.addToCart)} → Checkout ${fmtInt(f.initiateCheckout)} → Purchases ${fmtInt(f.purchases)}`);
    lines.push("");
  }

  // ---- GA4 ----
  if (ctx.ga4) {
    const g = ctx.ga4.overview;
    lines.push("GOOGLE ANALYTICS (последните 30 дни):");
    lines.push(`  Сесии: ${fmtInt(g.sessions)} | Потребители: ${fmtInt(g.users)} | Engagement: ${fmtPct(g.engagementRate)} | Покупки: ${fmtInt(g.purchases)}`);

    if (ctx.ga4.channels.length > 0) {
      const totalSessions = ctx.ga4.channels.reduce((s, c) => s + c.sessions, 0);
      lines.push("  Канали (по сесии):");
      ctx.ga4.channels.forEach((c) => {
        const pct = totalSessions > 0 ? ((c.sessions / totalSessions) * 100).toFixed(1) : "0";
        lines.push(`    - ${c.channel}: ${fmtInt(c.sessions)} (${pct}%)`);
      });
    }

    if (ctx.ga4.topPages.length > 0) {
      lines.push("  Топ страници:");
      ctx.ga4.topPages.forEach((p) => {
        lines.push(`    - ${p.page}: ${fmtInt(p.sessions)} сесии, ${p.conversions} конверсии`);
      });
    }

    if (ctx.ga4.devices.length > 0) {
      lines.push("  Устройства:");
      ctx.ga4.devices.forEach((d) => {
        lines.push(`    - ${d.device}: ${fmtInt(d.sessions)} сесии`);
      });
    }
    lines.push("");
  }

  // ---- Klaviyo ----
  if (ctx.klaviyo) {
    const k = ctx.klaviyo;
    lines.push("KLAVIYO — ИМЕЙЛ МАРКЕТИНГ (последните 30 дни):");
    lines.push(`  Общ приход: ${fmtNum(k.totalRevenue)} EUR (кампании: ${fmtNum(k.campaignRevenue)} EUR, flows: ${fmtNum(k.flowRevenue)} EUR)`);
    lines.push(`  Изпратени имейли: ${fmtInt(k.totalEmails)} | Open rate: ${fmtPct(k.avgOpenRate)} | Click rate: ${fmtPct(k.avgClickRate)}`);
    lines.push(`  Активни flows: ${k.activeFlows} / ${k.totalFlows}`);

    if (k.topFlows.length > 0) {
      lines.push("  Топ flows по приход:");
      k.topFlows.forEach((f) => {
        lines.push(`    - ${f.name}: ${fmtNum(f.revenue)} EUR, open ${fmtPct(f.openRate)}, click ${fmtPct(f.clickRate)}`);
      });
    }
    lines.push("");
  }

  // ---- Customers ----
  if (ctx.customers) {
    const c = ctx.customers;
    lines.push("КЛИЕНТИ (последните 90 дни):");
    lines.push(`  Общо: ${fmtInt(c.totalCustomers)} (нови: ${fmtInt(c.newCustomers)}, връщащи се: ${fmtInt(c.returningCustomers)})`);
    lines.push(`  Repeat purchase rate: ${c.repeatPurchaseRate}%`);
    if (c.avgTimeTo2ndPurchase !== null) {
      lines.push(`  Средно време до 2-ра поръчка: ${c.avgTimeTo2ndPurchase} дни`);
    }
    lines.push(`  Приход на клиент: ${fmtNum(c.revenuePerCustomer)} EUR`);
    lines.push("");
  }

  if (!ctx.shopify && !ctx.ga4 && !ctx.klaviyo && !ctx.meta && !ctx.customers) {
    lines.push("(Бизнес данните не са достъпни в момента)");
  }

  return lines.join("\n");
}
