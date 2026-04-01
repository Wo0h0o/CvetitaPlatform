"use client";

import useSWR from "swr";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { Skeleton } from "@/components/shared/Skeleton";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface TrafficData {
  channels?: { channel: string; sessions: number }[];
  error?: string;
}

const channelColors: Record<string, string> = {
  "Organic Search": "bg-accent",
  "Direct": "bg-blue",
  "Paid Search": "bg-orange",
  "Organic Social": "bg-purple-500",
  "Paid Social": "bg-red",
  "Email": "bg-blue",
  "Referral": "bg-orange",
  "Display": "bg-red",
};

export function ChannelBreakdown() {
  const { data, isLoading } = useSWR<TrafficData>(
    "/api/dashboard/traffic",
    fetcher,
    { revalidateOnFocus: false }
  );

  if (isLoading) {
    return (
      <Card>
        <CardBody><Skeleton className="h-40 w-full" /></CardBody>
      </Card>
    );
  }

  if (data?.error || !data?.channels?.length) {
    return (
      <Card>
        <CardHeader>Канали</CardHeader>
        <CardBody>
          <div className="text-center py-8 text-text-3 text-[13px]">GA4 не е свързан</div>
        </CardBody>
      </Card>
    );
  }

  const channels = data.channels.slice(0, 6);
  const totalSessions = channels.reduce((s, c) => s + c.sessions, 0) || 1;

  return (
    <Card>
      <CardHeader
        action={
          <span className="text-[12px] text-text-3">
            {totalSessions.toLocaleString("bg-BG")} сесии (30д)
          </span>
        }
      >
        Канали
      </CardHeader>
      <CardBody>
        <div className="space-y-3">
          {channels.map((ch) => {
            const pct = (ch.sessions / totalSessions) * 100;
            const color = channelColors[ch.channel] || "bg-text-3";
            return (
              <div key={ch.channel}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[13px] text-text">{ch.channel}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-text-2">
                      {ch.sessions.toLocaleString("bg-BG")}
                    </span>
                    <span className="text-[11px] text-text-3 w-10 text-right">
                      {pct.toFixed(0)}%
                    </span>
                  </div>
                </div>
                <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${color} transition-all duration-700`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}
