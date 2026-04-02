export type DatePreset = "today" | "yesterday" | "7d" | "30d" | "90d" | "custom";

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string;
  compFrom: string; // previous period for comparison
  compTo: string;
  preset: DatePreset;
  label: string;
}

function formatDateUTC(d: Date): string {
  return d.toISOString().split("T")[0];
}

function daysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return formatDateUTC(d);
}

export function getDateRange(preset: DatePreset, customFrom?: string, customTo?: string): DateRange {
  const today = formatDate(new Date());

  let from: string;
  let to: string;
  let label: string;

  switch (preset) {
    case "today":
      from = today;
      to = today;
      label = "Днес";
      break;
    case "yesterday":
      from = daysAgo(1);
      to = daysAgo(1);
      label = "Вчера";
      break;
    case "7d":
      from = daysAgo(6);
      to = today;
      label = "7 дни";
      break;
    case "30d":
      from = daysAgo(29);
      to = today;
      label = "30 дни";
      break;
    case "90d":
      from = daysAgo(89);
      to = today;
      label = "90 дни";
      break;
    case "custom":
      from = customFrom || daysAgo(29);
      to = customTo || today;
      label = `${from} — ${to}`;
      break;
    default:
      from = daysAgo(29);
      to = today;
      label = "30 дни";
  }

  // Comparison: previous period of equal length
  const fromDate = new Date(from + "T00:00:00Z");
  const toDate = new Date(to + "T00:00:00Z");
  const diffMs = toDate.getTime() - fromDate.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  const compToDate = new Date(fromDate);
  compToDate.setUTCDate(compToDate.getUTCDate() - 1);
  const compFromDate = new Date(compToDate);
  compFromDate.setUTCDate(compFromDate.getUTCDate() - diffDays);

  return {
    from,
    to,
    compFrom: formatDateUTC(compFromDate),
    compTo: formatDateUTC(compToDate),
    preset,
    label,
  };
}

export function formatBgDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("bg-BG", {
    day: "numeric",
    month: "short",
  });
}
