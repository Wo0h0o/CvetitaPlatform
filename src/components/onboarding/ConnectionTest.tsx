"use client";

import { useState } from "react";
import { Button } from "@/components/shared/Button";
import { Badge } from "@/components/shared/Badge";
import { Wifi, WifiOff, Loader2 } from "lucide-react";

interface ConnectionResult {
  ok: boolean;
  shopName?: string;
  shopEmail?: string;
  shopPlan?: string;
  shopDomain?: string;
  error?: string;
}

interface ConnectionTestProps {
  domain: string;
  accessToken: string;
  onResult: (result: ConnectionResult) => void;
}

export function ConnectionTest({ domain, accessToken, onResult }: ConnectionTestProps) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ConnectionResult | null>(null);

  async function handleTest() {
    if (!domain || !accessToken) return;

    setTesting(true);
    setResult(null);

    try {
      const res = await fetch("/api/stores/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, accessToken }),
      });

      const data: ConnectionResult = await res.json();
      setResult(data);
      onResult(data);
    } catch {
      const errResult: ConnectionResult = { ok: false, error: "Мрежова грешка" };
      setResult(errResult);
      onResult(errResult);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-3">
      <Button
        onClick={handleTest}
        disabled={testing || !domain || !accessToken}
        variant="secondary"
        className="w-full"
      >
        {testing ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            Тестване...
          </>
        ) : (
          <>
            <Wifi size={16} />
            Тествай връзката
          </>
        )}
      </Button>

      {result && (
        <div
          className={`rounded-lg p-4 text-[13px] ${
            result.ok
              ? "bg-accent-soft border border-accent/20"
              : "bg-red-soft border border-red/20"
          }`}
        >
          {result.ok ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 font-medium text-accent">
                <Wifi size={14} />
                Връзката е успешна
              </div>
              <div className="text-text-2">
                <span className="font-medium text-text">{result.shopName}</span>
                {result.shopEmail && (
                  <span className="ml-2 text-text-3">({result.shopEmail})</span>
                )}
              </div>
              {result.shopPlan && (
                <Badge variant="blue">{result.shopPlan}</Badge>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-red">
              <WifiOff size={14} />
              <span>{result.error}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
