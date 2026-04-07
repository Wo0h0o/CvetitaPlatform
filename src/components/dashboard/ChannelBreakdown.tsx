"use client";

import useSWR from "swr";
import { DonutChart } from "@/components/charts";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface TrafficData {
  channels?: { channel: string; sessions: number }[];
  error?: string;
}

const CHANNEL_COLORS = ["#22c55e", "#007aff", "#ff9500", "#8b5cf6", "#ff3b30", "#06b6d4"];

export function ChannelBreakdown() {
  const { data, isLoading } = useSWR<TrafficData>(
    "/api/dashboard/traffic",
    fetcher,
    { revalidateOnFocus: false }
  );

  if (!isLoading && (data?.error || !data?.channels?.length)) {
    return (
      <DonutChart
        data={[]}
        nameKey="channel"
        valueKey="sessions"
        title="Канали"
      />
    );
  }

  const channels = (data?.channels || []).slice(0, 6);
  const totalSessions = channels.reduce((s, c) => s + c.sessions, 0);

  return (
    <DonutChart
      data={channels}
      nameKey="channel"
      valueKey="sessions"
      title="Канали"
      action={
        <span className="text-[12px] text-text-2">
          {totalSessions.toLocaleString("bg-BG")} сесии (30д)
        </span>
      }
      loading={isLoading}
      height={260}
      colors={CHANNEL_COLORS}
    />
  );
}
