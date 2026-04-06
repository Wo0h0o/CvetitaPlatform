import { fetchWithTimeout } from "./fetch-utils";

const API_REVISION = "2024-10-15";
const PLACED_ORDER_METRIC_ID = "QXgXuq";

function getApiKey() {
  return process.env.KLAVIYO_API_KEY || "";
}

async function klaviyoGet(path: string): Promise<Record<string, unknown>> {
  const res = await fetchWithTimeout(`https://a.klaviyo.com${path}`, {
    headers: {
      Authorization: `Klaviyo-API-Key ${getApiKey()}`,
      revision: API_REVISION,
      Accept: "application/json",
    },
  }, 15_000);

  if (!res.ok) {
    throw new Error(`Klaviyo API error: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

async function klaviyoPost(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetchWithTimeout(`https://a.klaviyo.com${path}`, {
    method: "POST",
    headers: {
      Authorization: `Klaviyo-API-Key ${getApiKey()}`,
      revision: API_REVISION,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }, 15_000);

  if (!res.ok) {
    throw new Error(`Klaviyo API error: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

// ---- Reporting API types ----

interface ReportResult {
  groupings?: Record<string, string>;
  statistics: Record<string, number>;
}

interface ReportResponse {
  data?: {
    attributes?: {
      results?: ReportResult[];
    };
  };
}

interface FlowsListResponse {
  data?: { id: string; attributes: { name: string; status: string } }[];
}

interface CampaignsListResponse {
  data?: {
    id: string;
    attributes: { name: string; status: string; send_time: string; updated_at: string };
  }[];
}

// ---- Timeframe mapping ----

function getTimeframeKey(preset?: string): string {
  switch (preset) {
    case "today": return "today";
    case "7d": return "last_7_days";
    case "90d": return "last_90_days";
    default: return "last_30_days";
  }
}

// ---- Main export ----

export async function getKlaviyoMetrics(preset?: string) {
  if (!getApiKey()) return null;

  const timeframe = { key: getTimeframeKey(preset) };
  const stats = ["recipients", "open_rate", "click_rate", "conversion_value", "revenue_per_recipient", "unsubscribe_rate"];

  const [campaignReport, flowReport, campaignsList, flowsList] = await Promise.all([
    // Campaign aggregate stats
    klaviyoPost("/api/campaign-values-reports/", {
      data: {
        type: "campaign-values-report",
        attributes: {
          timeframe,
          conversion_metric_id: PLACED_ORDER_METRIC_ID,
          filter: 'equals(send_channel,"email")',
          statistics: stats,
        },
      },
    }) as Promise<ReportResponse>,

    // Flow aggregate stats grouped by flow
    klaviyoPost("/api/flow-values-reports/", {
      data: {
        type: "flow-values-report",
        attributes: {
          timeframe,
          conversion_metric_id: PLACED_ORDER_METRIC_ID,
          statistics: stats,
          group_by: ["flow_id", "flow_name", "flow_message_id"],
        },
      },
    }) as Promise<ReportResponse>,

    // Campaign list (for names and statuses)
    klaviyoGet("/api/campaigns/?filter=equals(messages.channel,'email')&sort=-updated_at") as Promise<CampaignsListResponse>,

    // Flows list (for statuses)
    klaviyoGet("/api/flows/") as Promise<FlowsListResponse>,
  ]);

  // --- Aggregate campaign stats ---
  const campaignResults = campaignReport.data?.attributes?.results || [];
  const campaignTotals = campaignResults.reduce(
    (acc, r) => {
      acc.revenue += r.statistics.conversion_value || 0;
      acc.recipients += r.statistics.recipients || 0;
      acc.openRateSum += (r.statistics.open_rate || 0) * (r.statistics.recipients || 0);
      acc.clickRateSum += (r.statistics.click_rate || 0) * (r.statistics.recipients || 0);
      return acc;
    },
    { revenue: 0, recipients: 0, openRateSum: 0, clickRateSum: 0 }
  );

  // --- Aggregate flow stats by flow name ---
  const flowResults = flowReport.data?.attributes?.results || [];
  const flowMap = new Map<string, { id: string; name: string; revenue: number; recipients: number; openRateSum: number; clickRateSum: number }>();

  for (const r of flowResults) {
    const flowId = r.groupings?.flow_id || "";
    const flowName = r.groupings?.flow_name || "Unknown";
    const existing = flowMap.get(flowId) || { id: flowId, name: flowName, revenue: 0, recipients: 0, openRateSum: 0, clickRateSum: 0 };
    const recip = r.statistics.recipients || 0;
    existing.revenue += r.statistics.conversion_value || 0;
    existing.recipients += recip;
    existing.openRateSum += (r.statistics.open_rate || 0) * recip;
    existing.clickRateSum += (r.statistics.click_rate || 0) * recip;
    flowMap.set(flowId, existing);
  }

  const flowTotals = Array.from(flowMap.values()).reduce(
    (acc, f) => {
      acc.revenue += f.revenue;
      acc.recipients += f.recipients;
      acc.openRateSum += f.openRateSum;
      acc.clickRateSum += f.clickRateSum;
      return acc;
    },
    { revenue: 0, recipients: 0, openRateSum: 0, clickRateSum: 0 }
  );

  // --- All flows by revenue ---
  const topFlows = Array.from(flowMap.values())
    .sort((a, b) => b.revenue - a.revenue)
    .map((f) => ({
      id: f.id,
      name: f.name,
      revenue: f.revenue,
      recipients: f.recipients,
      openRate: f.recipients > 0 ? f.openRateSum / f.recipients : 0,
      clickRate: f.recipients > 0 ? f.clickRateSum / f.recipients : 0,
      status: flowsList.data?.find((fl) => fl.id === f.id)?.attributes.status || "unknown",
    }));

  // --- Campaign details with stats ---
  const campaignDetails = (campaignsList.data || []).map((c) => {
    const report = campaignResults.find((r) => r.groupings?.campaign_id === c.id);
    return {
      name: c.attributes.name,
      status: c.attributes.status,
      sendTime: c.attributes.send_time,
      revenue: report?.statistics.conversion_value || 0,
      openRate: report?.statistics.open_rate || 0,
      clickRate: report?.statistics.click_rate || 0,
      recipients: report?.statistics.recipients || 0,
    };
  });

  // --- Totals ---
  const totalRecipients = campaignTotals.recipients + flowTotals.recipients;
  const totalRevenue = campaignTotals.revenue + flowTotals.revenue;
  const avgOpenRate = totalRecipients > 0
    ? (campaignTotals.openRateSum + flowTotals.openRateSum) / totalRecipients
    : 0;
  const avgClickRate = totalRecipients > 0
    ? (campaignTotals.clickRateSum + flowTotals.clickRateSum) / totalRecipients
    : 0;

  const activeFlows = flowsList.data?.filter((f) => f.attributes.status === "live").length || 0;
  const totalFlows = flowsList.data?.length || 0;

  return {
    totalRevenue,
    campaignRevenue: campaignTotals.revenue,
    flowRevenue: flowTotals.revenue,
    totalEmails: totalRecipients,
    avgOpenRate,
    avgClickRate,
    activeFlows,
    totalFlows,
    topFlows,
    campaigns: campaignDetails,
  };
}

// ---- Flow detail ----

export async function getFlowDetail(flowId: string, preset?: string) {
  if (!getApiKey()) return null;

  const timeframe = { key: getTimeframeKey(preset) };

  interface FlowResponse {
    data?: {
      attributes?: { name: string; status: string; trigger_type: string; created: string; updated: string };
    };
    included?: { type: string; id: string; attributes?: { action_type: string; status: string } }[];
  }

  interface FlowReportResponse {
    data?: {
      attributes?: {
        results?: {
          groupings?: Record<string, string>;
          statistics: Record<string, number>;
        }[];
      };
    };
  }

  const [flowData, messageStats] = await Promise.all([
    klaviyoGet(`/api/flows/${flowId}/?include=flow-actions&fields[flow-action]=action_type,status`) as Promise<FlowResponse>,
    klaviyoPost("/api/flow-values-reports/", {
      data: {
        type: "flow-values-report",
        attributes: {
          timeframe,
          conversion_metric_id: PLACED_ORDER_METRIC_ID,
          filter: `equals(flow_id,"${flowId}")`,
          statistics: [
            "recipients", "delivered", "open_rate", "click_rate",
            "conversion_value", "revenue_per_recipient",
            "unsubscribe_rate", "bounce_rate",
          ],
          group_by: ["flow_id", "flow_message_id", "flow_message_name"],
        },
      },
    }) as Promise<FlowReportResponse>,
  ]);

  const attrs = flowData.data?.attributes;
  const actions = flowData.included?.filter((i) => i.type === "flow-action") || [];
  const emailActions = actions.filter((a) => a.attributes?.action_type === "SEND_EMAIL");
  const delayActions = actions.filter((a) => a.attributes?.action_type === "TIME_DELAY");

  const messageResults = messageStats.data?.attributes?.results || [];

  // Aggregate totals
  let totalRevenue = 0;
  let totalRecipients = 0;
  let openRateSum = 0;
  let clickRateSum = 0;

  const messages = messageResults.map((r) => {
    const recip = r.statistics.recipients || 0;
    totalRevenue += r.statistics.conversion_value || 0;
    totalRecipients += recip;
    openRateSum += (r.statistics.open_rate || 0) * recip;
    clickRateSum += (r.statistics.click_rate || 0) * recip;

    return {
      id: r.groupings?.flow_message_id || "",
      name: r.groupings?.flow_message_name || "Unnamed",
      recipients: recip,
      openRate: r.statistics.open_rate || 0,
      clickRate: r.statistics.click_rate || 0,
      revenue: r.statistics.conversion_value || 0,
      revenuePerRecipient: r.statistics.revenue_per_recipient || 0,
      unsubscribeRate: r.statistics.unsubscribe_rate || 0,
      bounceRate: r.statistics.bounce_rate || 0,
    };
  });

  return {
    flow: {
      id: flowId,
      name: attrs?.name || "Unknown",
      status: attrs?.status || "unknown",
      triggerType: attrs?.trigger_type || "",
      created: attrs?.created || "",
      updated: attrs?.updated || "",
      emailCount: emailActions.length,
      delayCount: delayActions.length,
    },
    totals: {
      revenue: totalRevenue,
      recipients: totalRecipients,
      avgOpenRate: totalRecipients > 0 ? openRateSum / totalRecipients : 0,
      avgClickRate: totalRecipients > 0 ? clickRateSum / totalRecipients : 0,
    },
    messages,
  };
}
