"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/shared/Button";
import { Tabs } from "@/components/shared/Tabs";
import { Search, Sparkles, Loader2, Image as ImageIcon, Check } from "lucide-react";

interface ShopifyMatch {
  id: string;
  handle: string;
  title: string;
  productType: string;
  image: string | null;
  price: string | null;
}

interface Suggestion {
  shopifyId: string;
  handle: string;
  title: string;
  confidence: number;
  reasoning: string;
}

interface MappingModalProps {
  open: boolean;
  onClose: () => void;
  competitor: { slug: string };
  product: { url: string; name: string; price: number | null; currency: string | null } | null;
  onSaved: () => void;
}

type TabId = "search" | "ai";

export function MappingModal({ open, onClose, competitor, product, onSaved }: MappingModalProps) {
  const [tab, setTab] = useState<TabId>("search");
  const [q, setQ] = useState("");
  const [searchResults, setSearchResults] = useState<ShopifyMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [selectedShopifyId, setSelectedShopifyId] = useState<string | null>(null);
  const [selectedFromAI, setSelectedFromAI] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Reset state on (re)open
  useEffect(() => {
    if (open) {
      setTab("search");
      setQ(product?.name?.split(" ").slice(0, 2).join(" ") || "");
      setSearchResults([]);
      setSuggestions(null);
      setAiError(null);
      setSelectedShopifyId(null);
      setSelectedFromAI(false);
      setSaveError(null);
    }
  }, [open, product]);

  // Debounced search
  useEffect(() => {
    if (!open || tab !== "search" || q.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(q)}`);
        const json = await res.json();
        setSearchResults(json.products || []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, tab, open]);

  const handleAiSuggest = async () => {
    if (!product) return;
    setAiLoading(true);
    setAiError(null);
    setSuggestions(null);
    try {
      const res = await fetch(`/api/competitors/${competitor.slug}/mappings/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          competitorProductUrl: product.url,
          competitorProductName: product.name,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "AI suggest неуспешен");
      setSuggestions(json.suggestions || []);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Грешка");
    } finally {
      setAiLoading(false);
    }
  };

  const handleSave = async () => {
    if (!product || !selectedShopifyId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/competitors/${competitor.slug}/mappings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          competitorProductUrl: product.url,
          competitorProductName: product.name,
          shopifyProductId: selectedShopifyId,
          source: selectedFromAI ? "ai_suggested" : "manual",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Грешка при запис");
      onSaved();
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Грешка");
    } finally {
      setSaving(false);
    }
  };

  if (!product) return null;

  return (
    <Modal open={open} onClose={onClose} title="Свържи продукт" size="lg">
      <div className="space-y-4">
        {/* Their product header */}
        <div className="px-3 py-2 rounded-lg bg-surface-2">
          <div className="text-[11px] text-text-3 uppercase tracking-wide">Конкурентен продукт</div>
          <div className="text-[14px] font-semibold text-text">{product.name}</div>
          {product.price !== null && (
            <div className="text-[12px] text-text-2">
              {product.price.toFixed(2)} {product.currency}
            </div>
          )}
        </div>

        <Tabs<TabId>
          tabs={[
            { id: "search", label: "Търси в каталог", icon: <Search size={13} /> },
            { id: "ai", label: "AI предложи", icon: <Sparkles size={13} /> },
          ]}
          active={tab}
          onChange={(t) => {
            setTab(t);
            setSelectedShopifyId(null);
            setSelectedFromAI(t === "ai");
          }}
        />

        {tab === "search" && (
          <div>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Търси по име, тип, описание…"
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2.5 text-[14px] text-text outline-none focus:border-accent placeholder:text-text-3"
              autoFocus
            />
            <div className="mt-3 max-h-[320px] overflow-y-auto space-y-1">
              {searching && (
                <div className="flex items-center gap-2 text-[12px] text-text-3 px-2 py-2">
                  <Loader2 size={12} className="animate-spin" /> Търсене…
                </div>
              )}
              {!searching && q.trim().length >= 2 && searchResults.length === 0 && (
                <p className="text-[12px] text-text-3 px-2">Няма съвпадения.</p>
              )}
              {searchResults.map((p) => (
                <ProductRow
                  key={p.id}
                  product={p}
                  selected={selectedShopifyId === p.id}
                  onSelect={() => {
                    setSelectedShopifyId(p.id);
                    setSelectedFromAI(false);
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {tab === "ai" && (
          <div>
            {!suggestions && !aiLoading && (
              <div className="text-center py-6">
                <p className="text-[13px] text-text-2 mb-3">
                  Натисни „Предложи“, за да получиш топ 3 най-вероятни наши продукти от AI.
                </p>
                <Button onClick={handleAiSuggest} disabled={aiLoading}>
                  <Sparkles size={14} /> Предложи
                </Button>
              </div>
            )}
            {aiLoading && (
              <div className="flex items-center justify-center gap-2 text-[13px] text-text-2 py-6">
                <Loader2 size={14} className="animate-spin" />
                Анализирам каталога…
              </div>
            )}
            {aiError && <p className="text-[12px] text-red px-2 py-2">{aiError}</p>}
            {suggestions && suggestions.length === 0 && (
              <p className="text-[12px] text-text-3 px-2 py-2">AI не върна предложения.</p>
            )}
            {suggestions && suggestions.length > 0 && (
              <div className="space-y-2">
                {suggestions.map((s) => (
                  <SuggestionCard
                    key={s.shopifyId}
                    suggestion={s}
                    selected={selectedShopifyId === s.shopifyId}
                    onSelect={() => {
                      setSelectedShopifyId(s.shopifyId);
                      setSelectedFromAI(true);
                    }}
                  />
                ))}
                <div className="pt-2">
                  <Button variant="secondary" size="sm" onClick={handleAiSuggest} disabled={aiLoading}>
                    Опитай отново
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Save */}
        {saveError && <p className="text-[12px] text-red">{saveError}</p>}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <Button variant="ghost" onClick={onClose}>
            Отказ
          </Button>
          <Button onClick={handleSave} disabled={!selectedShopifyId || saving}>
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Запази
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ProductRow({
  product,
  selected,
  onSelect,
}: {
  product: ShopifyMatch;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`
        w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors cursor-pointer
        ${selected ? "bg-accent-soft border border-accent" : "hover:bg-surface-2 border border-transparent"}
      `}
    >
      <div className="w-10 h-10 rounded-lg bg-surface-2 flex items-center justify-center flex-shrink-0 overflow-hidden">
        {product.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.image} alt="" className="w-full h-full object-cover" />
        ) : (
          <ImageIcon size={14} className="text-text-3" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-text truncate">{product.title}</div>
        <div className="text-[11px] text-text-3">{product.productType || "—"}</div>
      </div>
      {product.price && (
        <div className="text-[13px] font-semibold text-text flex-shrink-0">
          {Number(product.price).toFixed(2)}
        </div>
      )}
      {selected && <Check size={14} className="text-accent flex-shrink-0" />}
    </button>
  );
}

function SuggestionCard({
  suggestion: s,
  selected,
  onSelect,
}: {
  suggestion: Suggestion;
  selected: boolean;
  onSelect: () => void;
}) {
  const pct = Math.round(s.confidence * 100);
  const tone = s.confidence >= 0.75 ? "text-accent" : s.confidence >= 0.5 ? "text-orange" : "text-text-3";
  return (
    <button
      onClick={onSelect}
      className={`
        w-full text-left p-3 rounded-lg transition-colors cursor-pointer
        ${selected ? "bg-accent-soft border border-accent" : "bg-surface-2 border border-transparent hover:border-border-strong"}
      `}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[13px] font-semibold text-text">{s.title}</span>
        <span className={`text-[12px] font-semibold ${tone}`}>{pct}%</span>
      </div>
      <p className="text-[12px] text-text-2 leading-snug">{s.reasoning}</p>
      {selected && (
        <div className="mt-2 flex items-center gap-1 text-[11px] text-accent">
          <Check size={11} /> Избран
        </div>
      )}
    </button>
  );
}
