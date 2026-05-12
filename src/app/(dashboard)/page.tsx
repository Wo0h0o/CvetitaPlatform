"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { KpiStrip } from "@/components/dashboard/KpiStrip";
import { StoresTable } from "@/components/dashboard/StoresTable";
import { ActionRow } from "@/components/dashboard/ActionRow";
import { useDateRange } from "@/hooks/useDateRange";

export default function DashboardPage() {
  // Dashboard defaults to "today" — the tempo tiles (vsTypical pacing,
  // end-of-day projection) only make sense for the current Sofia day.
  // Other presets fall back to range-aggregate rendering.
  const { queryString, preset, label } = useDateRange("today");

  return (
    <>
      <PageHeader title="Командно табло">
        <DateRangePicker defaultPreset="today" />
      </PageHeader>
      <KpiStrip queryString={queryString} preset={preset} rangeLabel={label} />
      <StoresTable queryString={queryString} rangeLabel={label} preset={preset} />
      <ActionRow />
    </>
  );
}
