// Fetches real business data and formats it as context for AI agents
// This is injected into every agent's system prompt automatically

interface BusinessContext {
  shopify: {
    salesToday: number;
    ordersToday: number;
    aov: number;
    topProducts: { title: string; quantity: number; revenue: number }[];
  } | null;
  ga4: {
    sessions: number;
    users: number;
    engagementRate: number;
    purchases: number;
  } | null;
  klaviyo: {
    totalSubscribers: number;
    activeFlows: number;
  } | null;
}

export async function fetchBusinessContext(
  baseUrl: string
): Promise<BusinessContext> {
  const results = await Promise.allSettled([
    fetch(`${baseUrl}/api/dashboard/kpis`).then((r) => r.json()),
    fetch(`${baseUrl}/api/dashboard/top-products`).then((r) => r.json()),
    fetch(`${baseUrl}/api/dashboard/email`).then((r) => r.json()),
  ]);

  const kpis = results[0].status === "fulfilled" ? results[0].value : null;
  const products =
    results[1].status === "fulfilled" ? results[1].value : null;
  const email = results[2].status === "fulfilled" ? results[2].value : null;

  return {
    shopify: kpis
      ? {
          salesToday: kpis.sales?.value ?? 0,
          ordersToday: kpis.orders?.value ?? 0,
          aov: kpis.aov?.value ?? 0,
          topProducts: Array.isArray(products) ? products.slice(0, 5) : [],
        }
      : null,
    ga4: kpis
      ? {
          sessions: kpis.sessions?.value ?? 0,
          users: 0,
          engagementRate: 0,
          purchases: 0,
        }
      : null,
    klaviyo: email
      ? {
          totalSubscribers: email.totalSubscribers ?? 0,
          activeFlows: email.activeFlows ?? 0,
        }
      : null,
  };
}

export function formatContextForPrompt(ctx: BusinessContext): string {
  const lines: string[] = ["=== АКТУАЛНИ БИЗНЕС ДАННИ (днес) ===", ""];

  if (ctx.shopify) {
    lines.push("📦 Shopify (продажби):");
    lines.push(`  • Приходи днес: ${ctx.shopify.salesToday.toFixed(2)} EUR`);
    lines.push(`  • Поръчки днес: ${ctx.shopify.ordersToday}`);
    lines.push(`  • Среден чек (AOV): ${ctx.shopify.aov.toFixed(2)} EUR`);
    if (ctx.shopify.topProducts.length > 0) {
      lines.push(`  • Топ продукти днес:`);
      ctx.shopify.topProducts.forEach((p) => {
        lines.push(
          `    - ${p.title}: ${p.quantity} бр. / ${p.revenue.toFixed(2)} EUR`
        );
      });
    }
    lines.push("");
  }

  if (ctx.ga4) {
    lines.push("📊 Google Analytics (последните 30 дни):");
    lines.push(
      `  • Сесии: ${ctx.ga4.sessions.toLocaleString("bg-BG")}`
    );
    lines.push("");
  }

  if (ctx.klaviyo) {
    lines.push("📧 Klaviyo (имейл маркетинг):");
    lines.push(
      `  • Абонати: ${ctx.klaviyo.totalSubscribers.toLocaleString("bg-BG")}`
    );
    lines.push(`  • Активни flows: ${ctx.klaviyo.activeFlows}`);
    lines.push("");
  }

  if (!ctx.shopify && !ctx.ga4 && !ctx.klaviyo) {
    lines.push("(Бизнес данните не са достъпни в момента)");
  }

  return lines.join("\n");
}
