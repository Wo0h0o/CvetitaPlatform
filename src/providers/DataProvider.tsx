"use client";

import { useState, useEffect, ReactNode } from "react";
import { mutate } from "swr";
import { LoadingScreen } from "@/components/layout/LoadingScreen";

// Module-level flag: persists across client-side navigations, resets on hard reload
// This ensures the loading screen only shows on page load, not on tab switching
let hasPreloaded = false;

// Critical APIs to prefetch — these feed dashboard + subpages
const CRITICAL_APIS = [
  "/api/dashboard/kpis",
  "/api/dashboard/top-products",
  "/api/dashboard/products-analytics?preset=30d",
  "/api/dashboard/traffic",
  "/api/dashboard/email",
];

export function DataProvider({ children }: { children: ReactNode }) {
  const [progress, setProgress] = useState(hasPreloaded ? 100 : 5);
  const [ready, setReady] = useState(hasPreloaded);

  useEffect(() => {
    if (hasPreloaded) return;

    let completed = 0;

    const fetchAndCache = async (url: string) => {
      try {
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          // Pre-populate the global SWR cache so components mount with data
          await mutate(url, data, { revalidate: false });
        }
      } catch {
        // One failed API shouldn't block the whole loading screen
      }
      completed++;
      // Progress goes from 5% → 90% during fetches, then jumps to 100%
      setProgress(5 + Math.round((completed / CRITICAL_APIS.length) * 85));
    };

    Promise.all(CRITICAL_APIS.map(fetchAndCache)).then(() => {
      setProgress(100);
      hasPreloaded = true;
      // Wait for the progress bar animation + fade-out to complete
      setTimeout(() => setReady(true), 700);
    });
  }, []);

  return (
    <>
      {!ready && <LoadingScreen progress={progress} />}
      {ready && children}
    </>
  );
}
