/* eslint-disable @next/next/no-img-element */
"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import useSWR from "swr";
import {
  Send, PenTool, Loader2, ExternalLink, ChevronDown, ChevronUp,
  Globe, SlidersHorizontal, X, Search, ShoppingBag, Package,
} from "lucide-react";
import { Card } from "@/components/shared/Card";
import { Markdown } from "@/components/shared/Markdown";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// --- Types ---
interface UserMessage { role: "user"; content: string }
interface AssistantMessage { role: "assistant"; content: string; sources?: { title: string; url: string }[]; searches?: string[]; tools?: string[] }
interface StatusMessage { role: "status"; msg: string }
type Message = UserMessage | AssistantMessage | StatusMessage;

interface SlimProduct {
  handle: string;
  title: string;
  productType: string;
  image: string | null;
  price: string;
}

// --- Settings options ---
const AVATARS = [
  { id: "Стефан (Performance Seeker, М 28-40)", label: "Стефан", tag: "М 28-40", emoji: "💪", desc: "Трениращ, удря плато. Иска данни и наука за натурален тестостерон." },
  { id: "Мария (Health-Conscious Parent, Ж 30-50)", label: "Мария", tag: "Ж 30-50", emoji: "👩‍👧", desc: "Защитава семейството. Проучва преди покупка, търси доверие." },
  { id: "Петър (Proactive Health Manager, М 35-55)", label: "Петър", tag: "М 35-55", emoji: "🩺", desc: "Наскоро здравно-осъзнат. Скептичен, иска механизми и обяснения." },
  { id: "Елена (Beauty & Wellness, Ж 25-45)", label: "Елена", tag: "Ж 25-45", emoji: "✨", desc: "Външен вид + вътрешно здраве. Instagram-influenced, чисти съставки." },
  { id: "Георги (Loyal Repeater, М 40-65)", label: "Георги", tag: "М 40-65", emoji: "🔄", desc: "Лоялен клиент, купува месечно. Иска удобство и cross-sell." },
];
const FORMATS = [
  { id: "Meta Feed Ad", label: "Meta Feed" },
  { id: "Instagram Stories/Reels", label: "Stories/Reels" },
  { id: "Google Ads", label: "Google Ads" },
  { id: "Carousel (3-5 карти, PAS)", label: "Carousel" },
  { id: "Advertorial (дълга форма)", label: "Advertorial" },
  { id: "Social Post", label: "Social Post" },
  { id: "Email Subject + Preview", label: "Email" },
];
const APPROACHES = [
  { id: "Образователен (teach first, sell second)", label: "Образователен" },
  { id: "Стойностен (Hormozi value stack)", label: "Стойностен" },
  { id: "Забележителен (Purple Cow)", label: "Забележителен" },
  { id: "Социално доказателство (testimonial style)", label: "Social Proof" },
];
const ANGLES = [
  { id: "Желан стейт (какво искат да станат)", label: "Желан стейт" },
  { id: "Решение на проблем (каква болка да премахнем)", label: "Проблем → Решение" },
  { id: "Идентичност (кой искат да бъдат)", label: "Идентичност" },
  { id: "Социално доказателство (други вече го ползват)", label: "Social Proof" },
];
const SUGGESTIONS = [
  "Напиши Meta реклама за избрания продукт",
  "Създай 3 hook варианта",
  "Помогни ми с launch кампания",
  "Направи Google Ads copy",
  "Създай Instagram carousel",
  "Напиши advertorial",
];
const INTENSITY_LABELS = ["Информативен", "Образователен", "Авторитетен", "Убеждаващ", "Директен"];

// --- Pill selector ---
function PillGroup<T extends string>({ options, value, onChange, label }: {
  options: { id: T; label: string; desc?: string }[];
  value: T; onChange: (v: T) => void; label: string;
}) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wider text-text-3 mb-1.5">{label}</div>
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => (
          <button key={opt.id} onClick={() => onChange(opt.id)} title={opt.desc}
            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer min-h-[34px] ${
              value === opt.id ? "bg-purple text-white shadow-sm" : "text-text-3 hover:text-text-2 bg-surface-2 hover:bg-border"
            }`}
          >{opt.label}</button>
        ))}
      </div>
    </div>
  );
}

// --- Intensity slider ---
function IntensitySlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wider text-text-3 mb-1.5">
        Интензивност: {value}/5 — {INTENSITY_LABELS[value - 1]}
      </div>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((level) => (
          <button key={level} onClick={() => onChange(level)}
            className={`flex-1 h-2.5 rounded-full transition-all cursor-pointer min-h-[34px] flex items-center justify-center ${
              level <= value ? "bg-purple" : "bg-surface-2"
            }`}
          >
            <div className={`w-full h-2.5 rounded-full ${level <= value ? "bg-purple" : "bg-surface-2"}`} />
          </button>
        ))}
      </div>
    </div>
  );
}

// --- Product picker modal ---
function ProductPickerModal({ onSelect, onClose }: {
  onSelect: (p: SlimProduct) => void; onClose: () => void;
}) {
  const { data } = useSWR<{ products: SlimProduct[] }>("/api/products/catalog", fetcher, { revalidateOnFocus: false });
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");

  const categories = useMemo(() => {
    if (!data?.products) return [];
    const cats = new Map<string, number>();
    data.products.forEach((p) => { const c = p.productType || "Друго"; cats.set(c, (cats.get(c) || 0) + 1); });
    return Array.from(cats.entries()).sort((a, b) => b[1] - a[1]);
  }, [data?.products]);

  const filtered = useMemo(() => {
    if (!data?.products) return [];
    let products = data.products;
    if (category !== "all") products = products.filter((p) => (p.productType || "Друго") === category);
    if (search) {
      const q = search.toLowerCase();
      products = products.filter((p) => p.title.toLowerCase().includes(q));
    }
    return products;
  }, [data?.products, category, search]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", handleKey); document.body.style.overflow = ""; };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full h-full md:h-auto md:max-h-[80vh] md:max-w-2xl md:rounded-2xl md:mt-[10vh] bg-surface shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <ShoppingBag size={16} className="text-purple" />
            <h3 className="text-[15px] font-semibold text-text">Избери продукт</h3>
            <span className="text-[12px] text-text-3">{filtered.length} продукта</span>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface-2 cursor-pointer"><X size={16} className="text-text-3" /></button>
        </div>

        {/* Search + Filters */}
        <div className="px-5 py-3 border-b border-border flex-shrink-0 space-y-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Търси продукт..."
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-surface-2 border border-border text-[13px] text-text outline-none focus:border-purple"
            />
          </div>
          <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1">
            <button onClick={() => setCategory("all")}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium whitespace-nowrap cursor-pointer min-h-[34px] ${
                category === "all" ? "bg-purple text-white" : "bg-surface-2 text-text-3 hover:text-text-2"
              }`}
            >Всички</button>
            {categories.map(([cat, count]) => (
              <button key={cat} onClick={() => setCategory(cat)}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium whitespace-nowrap cursor-pointer min-h-[34px] ${
                  category === cat ? "bg-purple text-white" : "bg-surface-2 text-text-3 hover:text-text-2"
                }`}
              >{cat} ({count})</button>
            ))}
          </div>
        </div>

        {/* Product grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {!data ? (
            <div className="flex items-center justify-center py-12 text-text-3">
              <Loader2 size={20} className="animate-spin mr-2" />Зареждам каталога...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-text-3">
              <Package size={24} className="mb-2 opacity-50" />
              <span className="text-[13px]">Няма продукти за &quot;{search}&quot;</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {filtered.map((p) => (
                <button key={p.handle} onClick={() => { onSelect(p); onClose(); }}
                  className="group bg-surface-2 rounded-xl overflow-hidden text-left hover:ring-2 hover:ring-purple/40 transition-all cursor-pointer"
                >
                  {p.image ? (
                    <img src={p.image} alt="" className="w-full aspect-square object-contain bg-white" />
                  ) : (
                    <div className="w-full aspect-square bg-surface flex items-center justify-center">
                      <Package size={24} className="text-text-3" />
                    </div>
                  )}
                  <div className="p-2.5">
                    <div className="text-[12px] font-medium text-text line-clamp-2 leading-tight mb-1">{p.title}</div>
                    <div className="text-[11px] font-semibold text-purple">{parseFloat(p.price).toFixed(2)} EUR</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Source cards ---
function SourceCard({ sources }: { sources: { title: string; url: string }[] }) {
  const [open, setOpen] = useState(false);
  if (sources.length === 0) return null;
  return (
    <div className="mt-3">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 text-[11px] text-text-3 hover:text-accent transition-colors cursor-pointer">
        <Globe size={11} />{sources.length} извор{sources.length > 1 ? "а" : ""}{open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          {sources.map((s, i) => (
            <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="flex items-start gap-2 p-2 rounded-lg bg-surface-2 hover:bg-border/30 transition-colors group">
              <ExternalLink size={11} className="text-text-3 mt-0.5 flex-shrink-0 group-hover:text-purple" />
              <span className="text-[11px] text-text-2 group-hover:text-purple line-clamp-1 leading-tight">{s.title || s.url}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Side panel content ---
function SidePanel({ avatar, setAvatar, format, setFormat, approach, setApproach, angle, setAngle,
  intensity, setIntensity, selectedProduct, onPickProduct }: {
  avatar: string; setAvatar: (v: string) => void;
  format: string; setFormat: (v: string) => void;
  approach: string; setApproach: (v: string) => void;
  angle: string; setAngle: (v: string) => void;
  intensity: number; setIntensity: (v: number) => void;
  selectedProduct: SlimProduct | null; onPickProduct: () => void;
}) {
  return (
    <div className="space-y-4">
      {/* Product */}
      <div>
        <div className="text-[10px] font-medium uppercase tracking-wider text-text-3 mb-1.5">Продукт</div>
        {selectedProduct ? (
          <div className="flex items-center gap-3 p-2.5 bg-surface-2 rounded-xl">
            {selectedProduct.image ? (
              <img src={selectedProduct.image} alt="" className="w-11 h-11 rounded-lg object-contain bg-white flex-shrink-0" />
            ) : (
              <div className="w-11 h-11 rounded-lg bg-surface flex items-center justify-center flex-shrink-0"><Package size={16} className="text-text-3" /></div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-medium text-text truncate">{selectedProduct.title}</div>
              <div className="text-[11px] text-purple font-semibold">{parseFloat(selectedProduct.price).toFixed(2)} EUR</div>
            </div>
            <button onClick={onPickProduct} className="text-[10px] text-text-3 hover:text-purple px-2 py-1 rounded-lg hover:bg-surface cursor-pointer">Смени</button>
          </div>
        ) : (
          <button onClick={onPickProduct}
            className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl border-2 border-dashed border-border hover:border-purple/40 text-[12px] text-text-3 hover:text-purple transition-all cursor-pointer min-h-[48px]"
          >
            <ShoppingBag size={14} />Избери продукт
          </button>
        )}
      </div>

      {/* Avatar cards */}
      <div>
        <div className="text-[10px] font-medium uppercase tracking-wider text-text-3 mb-1.5">Аватар</div>
        <div className="space-y-1.5">
          {AVATARS.map((a) => (
            <button key={a.id} onClick={() => setAvatar(a.id)}
              className={`w-full flex items-start gap-2.5 p-2.5 rounded-xl text-left transition-all cursor-pointer ${
                avatar === a.id ? "bg-purple/10 ring-1 ring-purple/40" : "bg-surface-2 hover:bg-border/30"
              }`}
            >
              <span className="text-[16px] leading-none mt-0.5">{a.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={`text-[12px] font-semibold ${avatar === a.id ? "text-purple" : "text-text"}`}>{a.label}</span>
                  <span className="text-[10px] text-text-3">{a.tag}</span>
                </div>
                <p className="text-[10px] text-text-3 leading-snug mt-0.5">{a.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
      <PillGroup options={FORMATS} value={format} onChange={setFormat} label="Формат" />
      <PillGroup options={APPROACHES} value={approach} onChange={setApproach} label="Подход" />
      <PillGroup options={ANGLES} value={angle} onChange={setAngle} label="Емоционален ъгъл" />
      <IntensitySlider value={intensity} onChange={setIntensity} />
    </div>
  );
}

// --- Main page ---
export default function AdCreatorPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const [showMobilePanel, setShowMobilePanel] = useState(false);
  const [showProductPicker, setShowProductPicker] = useState(false);

  // Settings
  const [avatar, setAvatar] = useState(AVATARS[0].id);
  const [format, setFormat] = useState(FORMATS[0].id);
  const [approach, setApproach] = useState(APPROACHES[0].id);
  const [intensity, setIntensity] = useState(3);
  const [angle, setAngle] = useState(ANGLES[0].id);
  const [selectedProduct, setSelectedProduct] = useState<SlimProduct | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const userScrolledUp = useRef(false);

  useEffect(() => {
    if (!userScrolledUp.current) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, searchQuery]);

  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const onScroll = () => { userScrolledUp.current = el.scrollHeight - el.scrollTop - el.clientHeight > 150; };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const send = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;
    setInput("");
    setLoading(true);
    setSearchQuery(null);
    setShowMobilePanel(false);
    userScrolledUp.current = false;

    const userMsg: UserMessage = { role: "user", content: text.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setMessages((prev) => [...prev, { role: "assistant", content: "", sources: [], searches: [], tools: [] } as AssistantMessage]);

    // Build context-enriched message for the API (user sees only their text)
    const settingsContext = [
      `[Избрани настройки от панела: Аватар: ${AVATARS.find((a) => a.id === avatar)?.label || avatar}`,
      `Формат: ${FORMATS.find((f) => f.id === format)?.label || format}`,
      `Подход: ${APPROACHES.find((a) => a.id === approach)?.label || approach}`,
      `Ъгъл: ${ANGLES.find((a) => a.id === angle)?.label || angle}`,
      `Интензивност: ${intensity}/5`,
      selectedProduct ? `Продукт: ${selectedProduct.title} (handle: ${selectedProduct.handle})` : "Продукт: не е избран",
      `]`,
    ].join(", ");
    const enrichedContent = `${settingsContext}\n\n${text.trim()}`;

    const conversationHistory = [
      ...messages.filter((m): m is UserMessage | AssistantMessage => m.role === "user" || m.role === "assistant"),
      { role: "user" as const, content: enrichedContent },
    ];

    try {
      const res = await fetch("/api/agents/ad-creator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: conversationHistory.map((m) => ({ role: m.role, content: m.content })),
          avatar, format, approach, intensity, angle,
          product: selectedProduct?.handle || null,
        }),
      });
      if (!res.ok) throw new Error("Agent error");

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const updateLast = (updater: (m: AssistantMessage) => AssistantMessage) => {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last.role === "assistant") next[next.length - 1] = updater(last as AssistantMessage);
          return next;
        });
      };

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
            if (evt.t === "status") {
              setMessages((prev) => {
                const filtered = prev.filter((m) => m.role !== "status");
                const last = filtered[filtered.length - 1];
                if (last?.role === "assistant" && last.content === "") {
                  return [...filtered.slice(0, -1), { role: "status", msg: evt.msg }, last];
                }
                return filtered;
              });
            }
            if (evt.t === "tool") updateLast((m) => ({ ...m, tools: [...(m.tools ?? []), evt.label] }));
            if (evt.t === "search") { setSearchQuery(evt.q); updateLast((m) => ({ ...m, searches: [...(m.searches ?? []), evt.q] })); }
            if (evt.t === "sources") { setSearchQuery(null); updateLast((m) => ({ ...m, sources: [...(m.sources ?? []), ...evt.results] })); }
            if (evt.t === "text") updateLast((m) => ({ ...m, content: m.content + evt.d }));
            if (evt.t === "replace") updateLast((m) => ({ ...m, content: evt.content }));
            if (evt.t === "done") { setSearchQuery(null); setMessages((prev) => prev.filter((m) => m.role !== "status")); }
            if (evt.t === "error") updateLast((m) => ({ ...m, content: `⚠️ ${evt.msg}` }));
          } catch { /* skip */ }
        }
      }
    } catch {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "assistant") (last as AssistantMessage).content = "⚠️ Грешка при свързване. Опитайте отново.";
        return next;
      });
    }
    setLoading(false);
    setSearchQuery(null);
    inputRef.current?.focus();
  }, [loading, messages, avatar, format, approach, intensity, angle, selectedProduct]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
  };

  const isEmpty = messages.length === 0;

  const panelContent = (
    <SidePanel
      avatar={avatar} setAvatar={setAvatar}
      format={format} setFormat={setFormat}
      approach={approach} setApproach={setApproach}
      angle={angle} setAngle={setAngle}
      intensity={intensity} setIntensity={setIntensity}
      selectedProduct={selectedProduct}
      onPickProduct={() => setShowProductPicker(true)}
    />
  );

  return (
    <>
      <div className="flex h-[calc(100vh-var(--topbar-height)-48px)] gap-0">
        {/* Desktop side panel */}
        <aside className="hidden md:block w-[320px] flex-shrink-0 border-r border-border bg-surface overflow-y-auto p-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg bg-purple-soft flex items-center justify-center">
              <SlidersHorizontal size={13} className="text-purple" />
            </div>
            <span className="text-[13px] font-semibold text-text">Настройки</span>
          </div>
          {panelContent}
        </aside>

        {/* Mobile side panel (drawer) */}
        {showMobilePanel && (
          <>
            <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setShowMobilePanel(false)} />
            <aside className="fixed inset-y-0 left-0 z-40 w-[300px] bg-surface shadow-lg overflow-y-auto p-4 md:hidden">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal size={13} className="text-purple" />
                  <span className="text-[13px] font-semibold text-text">Настройки</span>
                </div>
                <button onClick={() => setShowMobilePanel(false)} className="p-2 rounded-lg hover:bg-surface-2 cursor-pointer"><X size={16} className="text-text-3" /></button>
              </div>
              {panelContent}
            </aside>
          </>
        )}

        {/* Chat area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="flex items-center gap-3 p-4 pb-2 flex-shrink-0">
            <button onClick={() => setShowMobilePanel(true)} className="md:hidden w-9 h-9 rounded-xl bg-purple-soft flex items-center justify-center cursor-pointer">
              <SlidersHorizontal size={16} className="text-purple" />
            </button>
            <div className="hidden md:flex w-9 h-9 rounded-xl bg-purple items-center justify-center flex-shrink-0">
              <PenTool size={16} className="text-white" />
            </div>
            <div>
              <h1 className="text-[16px] font-semibold text-text">Рекламен Творец</h1>
              <p className="text-[12px] text-text-3">Копирайтинг · Реклами · Визуална насока</p>
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollAreaRef} className="flex-1 overflow-y-auto min-h-0 px-4">
            {isEmpty ? (
              <div className="flex flex-col items-center justify-center h-full pb-8">
                <div className="w-16 h-16 rounded-2xl bg-purple-soft flex items-center justify-center mb-5">
                  <PenTool size={28} className="text-purple" />
                </div>
                <h2 className="text-[20px] font-semibold text-text mb-2">Рекламен Творец</h2>
                <p className="text-[13px] text-text-3 text-center mb-2 max-w-sm">
                  Избери продукт и настрой параметрите отляво, след което опиши какво копи ти трябва.
                </p>
                <p className="text-[12px] text-text-3 text-center mb-8 max-w-sm md:hidden">
                  Натисни <SlidersHorizontal size={11} className="inline text-purple" /> за настройки.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => send(s)} className="text-left px-4 py-3 rounded-xl bg-surface border border-border hover:border-purple/40 hover:bg-purple-soft/30 transition-all text-[13px] text-text-2 hover:text-text cursor-pointer">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4 pb-4">
                {messages.map((msg, i) => {
                  if (msg.role === "status") return (
                    <div key={i} className="flex items-center gap-2 px-2 text-text-3">
                      <Loader2 size={12} className="animate-spin flex-shrink-0" /><span className="text-[12px]">{msg.msg}</span>
                    </div>
                  );
                  if (msg.role === "user") return (
                    <div key={i} className="flex justify-end">
                      <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-tr-sm bg-purple text-white text-[14px] leading-relaxed">{msg.content}</div>
                    </div>
                  );
                  const am = msg as AssistantMessage;
                  const isStreaming = loading && i === messages.length - 1;
                  return (
                    <div key={i} className="flex gap-3">
                      <div className="w-7 h-7 rounded-lg bg-purple-soft flex items-center justify-center flex-shrink-0 mt-0.5">
                        <PenTool size={13} className="text-purple" />
                      </div>
                      <div className="flex-1 min-w-0">
                        {am.tools && am.tools.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-2">
                            {am.tools.map((t, ti) => (
                              <span key={ti} className="px-2 py-0.5 rounded-full bg-purple-soft text-[10px] font-medium text-purple">{t}</span>
                            ))}
                          </div>
                        )}
                        {am.searches && am.searches.length > 0 && (
                          <div className="mb-3 space-y-1">
                            {am.searches.map((q, si) => (
                              <div key={si} className="flex items-center gap-2 text-[11px] text-text-3 bg-surface-2 px-3 py-1.5 rounded-lg w-fit">
                                <Globe size={10} /><span>Търсих: <em className="text-text-2">{q}</em></span>
                              </div>
                            ))}
                          </div>
                        )}
                        {am.content ? (
                          <Card>
                            <div className="p-4">
                              <Markdown text={am.content} />
                              {isStreaming && <span className="inline-block w-1 h-4 bg-purple animate-pulse ml-0.5 rounded-sm" />}
                              <SourceCard sources={am.sources ?? []} />
                            </div>
                          </Card>
                        ) : isStreaming ? (
                          <div className="flex items-center gap-2 text-text-3 py-2">
                            <Loader2 size={14} className="animate-spin" /><span className="text-[13px]">Създавам рекламно копи...</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
                {searchQuery && (
                  <div className="flex items-center gap-2 px-2">
                    <div className="w-7 h-7 rounded-lg bg-purple-soft flex items-center justify-center flex-shrink-0">
                      <Globe size={13} className="text-purple animate-pulse" />
                    </div>
                    <div className="flex items-center gap-2 text-[12px] text-text-3 bg-surface-2 px-3 py-2 rounded-lg">
                      <Loader2 size={11} className="animate-spin" />Търся: <em className="text-text-2 ml-1">{searchQuery}</em>
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          {/* Input */}
          <div className="p-4 pt-2 flex-shrink-0">
            <div className="flex gap-2 items-end bg-surface border border-border rounded-2xl p-2 focus-within:border-purple/50 transition-colors shadow-sm">
              <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
                placeholder="Какво копи ти трябва? Опиши продукт, аудитория, цел..."
                rows={1} disabled={loading}
                className="flex-1 bg-transparent text-[14px] text-text placeholder-text-3 outline-none resize-none py-1.5 px-2 max-h-32 min-h-[36px]"
                style={{ fieldSizing: "content" } as React.CSSProperties}
              />
              <button onClick={() => send(input)} disabled={!input.trim() || loading}
                className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 transition-all cursor-pointer ${
                  input.trim() && !loading ? "bg-purple hover:bg-purple/90 text-white shadow-sm" : "bg-surface-2 text-text-3 cursor-not-allowed"
                }`}
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              </button>
            </div>
            <p className="text-[11px] text-text-3 text-center mt-2">Enter за изпращане · Shift+Enter за нов ред</p>
          </div>
        </div>
      </div>

      {/* Product picker modal */}
      {showProductPicker && (
        <ProductPickerModal
          onSelect={setSelectedProduct}
          onClose={() => setShowProductPicker(false)}
        />
      )}
    </>
  );
}
