"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Sunrise, Loader2, RefreshCw } from "lucide-react";
import { Card } from "@/components/shared/Card";
import { Markdown } from "@/components/shared/Markdown";
import { PageHeader } from "@/components/shared/PageHeader";

// MarkdownText now uses shared Markdown component

export default function MorningReportPage() {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const hasGenerated = useRef(false);

  const generate = useCallback(async () => {
    setContent("");
    setLoading(true);
    setError(null);
    setStatus(null);

    try {
      const res = await fetch("/api/agents/morning-report", { method: "POST" });
      if (!res.ok) throw new Error("API error");

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.t === "status") setStatus(evt.msg);
            if (evt.t === "text") {
              setStatus(null);
              setContent((prev) => prev + evt.d);
            }
            if (evt.t === "done") setStatus(null);
            if (evt.t === "error") setError(evt.msg);
          } catch { /* skip */ }
        }
      }
    } catch {
      setError("Грешка при генериране на доклада. Опитайте отново.");
    }

    setLoading(false);
    setStatus(null);
  }, []);

  useEffect(() => {
    if (!hasGenerated.current) {
      hasGenerated.current = true;
      generate();
    }
  }, [generate]);

  const today = new Date().toLocaleDateString("bg-BG", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <>
      <PageHeader title="Сутрешен Доклад">
        <button
          onClick={generate}
          disabled={loading}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium transition-colors ${
            loading
              ? "bg-surface-2 text-text-3 cursor-not-allowed"
              : "bg-accent text-white hover:bg-accent-hover cursor-pointer"
          }`}
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Генерирай нов
        </button>
      </PageHeader>

      <p className="text-text-2 text-[13px] mb-4 capitalize">{today}</p>

      <div className="max-w-4xl" ref={contentRef}>
        {/* Status indicator */}
        {status && (
          <div className="flex items-center gap-2 mb-4 text-text-3">
            <Loader2 size={14} className="animate-spin" />
            <span className="text-[13px]">{status}</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <Card>
            <div className="p-5 text-center">
              <p className="text-[14px] text-red">{error}</p>
            </div>
          </Card>
        )}

        {/* Content */}
        {content ? (
          <Card>
            <div className="p-6">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-9 h-9 rounded-xl bg-accent-soft flex items-center justify-center">
                  <Sunrise size={18} className="text-accent" />
                </div>
                <div>
                  <h2 className="text-[15px] font-semibold text-text">AI Доклад</h2>
                  <p className="text-[12px] text-text-2">Базиран на реални данни от Shopify, Meta Ads, GA4, Klaviyo</p>
                </div>
              </div>
              <Markdown text={content} />
              {loading && <span className="inline-block w-1 h-4 bg-accent animate-pulse ml-0.5 rounded-sm" />}
            </div>
          </Card>
        ) : !loading && !error ? (
          <Card>
            <div className="p-12 text-center">
              <div className="w-14 h-14 rounded-2xl bg-accent-soft flex items-center justify-center mx-auto mb-4">
                <Sunrise size={24} className="text-accent" />
              </div>
              <p className="text-[15px] font-medium text-text mb-2">Сутрешен Доклад</p>
              <p className="text-[13px] text-text-2">Натиснете &quot;Генерирай нов&quot; за AI анализ на бизнеса.</p>
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}
