import { NextRequest } from "next/server";
import { getDateRange, type DatePreset } from "./dates";

export function parseDateParams(req: NextRequest) {
  const url = new URL(req.url);
  const preset = (url.searchParams.get("preset") as DatePreset) || "30d";
  const customFrom = url.searchParams.get("from") || undefined;
  const customTo = url.searchParams.get("to") || undefined;
  return getDateRange(preset, customFrom, customTo);
}

// For GET routes that use URL search params
export function parseDateFromURL(url: string) {
  const u = new URL(url, "http://localhost");
  const preset = (u.searchParams.get("preset") as DatePreset) || "30d";
  const customFrom = u.searchParams.get("from") || undefined;
  const customTo = u.searchParams.get("to") || undefined;
  return getDateRange(preset, customFrom, customTo);
}
