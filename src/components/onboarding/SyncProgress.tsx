"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/shared/Button";
import { Badge } from "@/components/shared/Badge";
import { Loader2, CheckCircle2, AlertCircle, Play } from "lucide-react";

type SyncStatus = "idle" | "syncing" | "done" | "error";

interface SyncResult {
  ok?: boolean;
  synced?: { products?: number; orders?: number };
  error?: string;
}

export function SyncProgress({ storeId }: { storeId: string }) {
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [result, setResult] = useState<SyncResult | null>(null);

  const startSync = useCallback(async () => {
    setStatus("syncing");
    setResult(null);

    try {
      const res = await fetch(`/api/stores/${storeId}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "all", daysBack: 90 }),
      });

      const data: SyncResult = await res.json();

      if (data.ok) {
        setStatus("done");
      } else {
        setStatus("error");
      }
      setResult(data);
    } catch {
      setStatus("error");
      setResult({ error: "Мрежова грешка при синхронизация" });
    }
  }, [storeId]);

  // Auto-start sync on mount
  useEffect(() => {
    startSync();
  }, [startSync]);

  return (
    <div className="space-y-4">
      {/* Status indicator */}
      <div className="flex items-center gap-3">
        {status === "syncing" && (
          <>
            <Loader2 size={20} className="animate-spin text-accent" />
            <div>
              <div className="text-[14px] font-medium text-text">Синхронизация...</div>
              <div className="text-[12px] text-text-2">
                Зареждане на продукти и поръчки от Shopify. Това може да отнеме няколко минути.
              </div>
            </div>
          </>
        )}

        {status === "done" && (
          <>
            <CheckCircle2 size={20} className="text-accent" />
            <div>
              <div className="text-[14px] font-medium text-text">Синхронизацията завърши</div>
              <div className="text-[12px] text-text-2">
                Данните са заредени успешно.
              </div>
            </div>
          </>
        )}

        {status === "error" && (
          <>
            <AlertCircle size={20} className="text-red" />
            <div>
              <div className="text-[14px] font-medium text-text">Грешка при синхронизация</div>
              <div className="text-[12px] text-red">
                {result?.error ?? "Непозната грешка"}
              </div>
            </div>
          </>
        )}

        {status === "idle" && (
          <>
            <Play size={20} className="text-text-2" />
            <div className="text-[14px] text-text-2">Готов за стартиране</div>
          </>
        )}
      </div>

      {/* Results */}
      {result?.synced && (
        <div className="flex gap-3">
          {result.synced.products !== undefined && (
            <Badge variant="blue">
              {result.synced.products} продукти
            </Badge>
          )}
          {result.synced.orders !== undefined && (
            <Badge variant="green">
              {result.synced.orders} поръчки
            </Badge>
          )}
        </div>
      )}

      {/* Retry button */}
      {status === "error" && (
        <Button onClick={startSync} variant="secondary" className="w-full">
          <Play size={16} />
          Опитай отново
        </Button>
      )}
    </div>
  );
}
