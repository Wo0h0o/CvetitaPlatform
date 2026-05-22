"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { Sunrise, Loader2, RefreshCw } from "lucide-react";
import { Card } from "@/components/shared/Card";
import { Markdown } from "@/components/shared/Markdown";
import { PageHeader } from "@/components/shared/PageHeader";
import { MiniKpi } from "@/components/shared/MiniKpi";

// Minimal slice of the BusinessContext snapshot the KPI strip reads.
interface MorningSnapshot {
  shopify: { salesToday: number; ordersToday: number } | null;
  ga4: { overview: { sessions: number } } | null;
  klaviyo: { totalRevenue: number } | null;
  meta: { overview: { roas: number } } | null;
}

function fmtEur(n: number): string {
  return `€${n.toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("bg-BG");
}

/**
 * The figures, lifted out of the prose. Five hero KPIs read straight from
 * the structured snapshot (never parsed from the AI markdown), each a
 * deep-link to the page that explains it — the briefing → drill-down chain.
 */
function MorningKpiStrip({ snapshot }: { snapshot: MorningSnapshot }) {
  const s = snapshot;
  const kpis: { href: string; label: string; value: string }[] = [
    { href: "/sales", label: "Приход вчера", value: s.shopify ? fmtEur(s.shopify.salesToday) : "—" },
    { href: "/sales", label: "Поръчки вчера", value: s.shopify ? fmtInt(s.shopify.ordersToday) : "—" },
    { href: "/ads", label: "ROAS · 7д", value: s.meta ? `${s.meta.overview.roas.toFixed(2)}x` : "—" },
    { href: "/traffic", label: "Трафик · сесии 30д", value: s.ga4 ? fmtInt(s.ga4.overview.sessions) : "—" },
    { href: "/email", label: "Имейл приход · 30д", value: s.klaviyo ? fmtEur(s.klaviyo.totalRevenue) : "—" },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
      {kpis.map((k) => (
        <Link
          key={k.label}
          href={k.href}
          className="block transition-transform hover:-translate-y-0.5"
        >
          <MiniKpi hero label={k.label} value={k.value} />
        </Link>
      ))}
    </div>
  );
}

export default function MorningReportPage() {
  const [content, setContent] = useState("");
  const [snapshot, setSnapshot] = useState<MorningSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const hasInit = useRef(false);

  // Stream a fresh report (Claude call). Used on a cache miss and by the
  // manual "Генерирай нов" button — the latter overwrites today's cache.
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
            if (evt.t === "snapshot") setSnapshot(evt.d);
            if (evt.t === "text") {
              setStatus(null);
              setContent((prev) => prev + evt.d);
            }
            if (evt.t === "done") {
              setStatus(null);
              setGeneratedAt(new Date().toISOString());
            }
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

  // On open: load today's cached report. Generate only on a cache miss —
  // a report is printed once per morning, not re-typeset on every glance.
  const init = useCallback(async () => {
    try {
      const res = await fetch("/api/agents/morning-report");
      if (res.ok) {
        const json = await res.json();
        if (json.report?.content) {
          setContent(json.report.content);
          setSnapshot(json.report.data_snapshot ?? null);
          setGeneratedAt(json.report.created_at ?? null);
          setLoading(false);
          return;
        }
      }
    } catch { /* fall through to a fresh generation */ }
    generate();
  }, [generate]);

  useEffect(() => {
    if (!hasInit.current) {
      hasInit.current = true;
      init();
    }
  }, [init]);

  const today = new Date().toLocaleDateString("bg-BG", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const generatedLabel = generatedAt
    ? `Генериран в ${new Date(generatedAt).toLocaleTimeString("bg-BG", { hour: "2-digit", minute: "2-digit" })} · Shopify, Meta Ads, GA4, Klaviyo`
    : "Базиран на реални данни от Shopify, Meta Ads, GA4, Klaviyo";

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
        {/* The figures, before the narrative */}
        {snapshot && <MorningKpiStrip snapshot={snapshot} />}

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
                  <p className="text-[12px] text-text-2">{generatedLabel}</p>
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
