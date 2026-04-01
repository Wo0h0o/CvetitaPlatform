const API_REVISION = "2024-10-15";

function getApiKey() {
  return process.env.KLAVIYO_API_KEY || "";
}

async function klaviyoGet(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`https://a.klaviyo.com${path}`, {
    headers: {
      Authorization: `Klaviyo-API-Key ${getApiKey()}`,
      revision: API_REVISION,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Klaviyo API error: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

export async function getKlaviyoMetrics() {
  if (!getApiKey()) {
    return null;
  }

  try {
    const [flowsRes, campaignsRes, listsRes] = await Promise.all([
      klaviyoGet("/api/flows/?page[size]=50") as Promise<{
        data?: { id: string; attributes: { name: string; status: string; trigger_type: string } }[];
      }>,
      klaviyoGet("/api/campaigns/?filter=equals(messages.channel,'email')&sort=-send_time&page[size]=10") as Promise<{
        data?: {
          id: string;
          attributes: {
            name: string;
            status: string;
            send_time: string;
          };
        }[];
      }>,
      klaviyoGet("/api/lists/?page[size]=50") as Promise<{
        data?: { id: string; attributes: { name: string; profile_count?: number } }[];
      }>,
    ]);

    const totalSubscribers = listsRes.data?.reduce(
      (sum, l) => sum + (l.attributes.profile_count || 0),
      0
    ) || 0;

    const activeFlows = flowsRes.data?.filter((f) => f.attributes.status === "live").length || 0;
    const totalFlows = flowsRes.data?.length || 0;

    const recentCampaigns = campaignsRes.data?.slice(0, 5).map((c) => ({
      name: c.attributes.name,
      status: c.attributes.status,
      sendTime: c.attributes.send_time,
    })) || [];

    return {
      totalSubscribers,
      activeFlows,
      totalFlows,
      recentCampaigns,
    };
  } catch (error) {
    console.error("Klaviyo error:", error);
    throw error;
  }
}
