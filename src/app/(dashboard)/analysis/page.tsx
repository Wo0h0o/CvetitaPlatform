"use client";

import { useState } from "react";
import { Card, CardBody } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { PageHeader } from "@/components/shared/PageHeader";
import { Search, Loader2, Copy, Check } from "lucide-react";

const analysisTypes = [
  { id: "morning", label: "Сутрешен доклад" },
  { id: "bg", label: "България" },
  { id: "eu", label: "Европа" },
  { id: "competitors", label: "Конкуренти" },
  { id: "opportunities", label: "Възможности" },
  { id: "ads", label: "Реклама" },
] as const;

const countries = [
  "България",
  "Румъния",
  "Германия",
  "Гърция",
  "Полша",
  "Цяла Европа",
];

export default function AnalysisPage() {
  const [activeType, setActiveType] = useState("morning");
  const [country, setCountry] = useState("България");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const runAnalysis = async () => {
    setLoading(true);
    setResult("");

    try {
      const res = await fetch("/api/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: activeType, country }),
      });

      if (!res.ok) throw new Error("Analysis failed");

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          setResult((prev) => prev + decoder.decode(value));
        }
      }
    } catch {
      setResult("Грешка при анализа. Проверете API ключа.");
    }

    setLoading(false);
  };

  const copyResult = () => {
    navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <PageHeader title="AI Анализ" />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {analysisTypes.map((type) => (
          <button
            key={type.id}
            onClick={() => setActiveType(type.id)}
            className={`
              px-4 py-2 rounded-full text-[13px] font-medium transition-all duration-150 cursor-pointer
              ${
                activeType === type.id
                  ? "bg-accent text-white shadow-sm"
                  : "bg-surface text-text-2 hover:text-text border border-border hover:border-border-strong"
              }
            `}
          >
            {type.label}
          </button>
        ))}

        <select
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className="ml-2 px-3 py-2 rounded-lg text-[13px] bg-surface border border-border text-text outline-none focus:border-accent transition-colors cursor-pointer"
        >
          {countries.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <Button
          onClick={runAnalysis}
          disabled={loading}
          className="ml-auto w-full md:w-auto"
        >
          {loading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Search size={16} />
          )}
          {loading ? "Анализира..." : "Анализирай"}
        </Button>
      </div>

      {/* Result */}
      {(result || loading) && (
        <Card>
          <CardBody>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[15px] font-semibold text-text">
                {analysisTypes.find((t) => t.id === activeType)?.label}
              </h3>
              {result && (
                <button
                  onClick={copyResult}
                  className="flex items-center gap-1.5 text-[12px] text-accent hover:text-accent-hover font-medium cursor-pointer"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? "Копирано" : "Копирай"}
                </button>
              )}
            </div>
            {loading && !result && (
              <div className="flex items-center gap-3 py-8 justify-center text-text-3">
                <Loader2 size={20} className="animate-spin" />
                <span className="text-[14px]">Анализирам пазара...</span>
              </div>
            )}
            <div className="text-[14px] leading-relaxed text-text whitespace-pre-wrap">
              {result}
            </div>
          </CardBody>
        </Card>
      )}

      {!result && !loading && (
        <div className="text-center py-20">
          <div className="text-text-3 text-[14px]">
            Избери тип анализ и натисни &quot;Анализирай&quot;
          </div>
        </div>
      )}
    </>
  );
}
