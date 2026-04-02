/* eslint-disable @next/next/no-img-element */
"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import useSWR from "swr";
import {
  PenTool, Loader2, Search, Package, ShoppingBag,
  ChevronRight, ChevronLeft, Check, Camera, FileText,
  Sun, Layers, Download, RefreshCw,
} from "lucide-react";
import { Card } from "@/components/shared/Card";
import { Markdown } from "@/components/shared/Markdown";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// --- Types ---
interface SlimProduct {
  handle: string; title: string; productType: string;
  image: string | null; price: string;
}

type Step = "product" | "settings" | "creative-type" | "generate" | "visuals";

const STEPS: { id: Step; label: string; num: number }[] = [
  { id: "product", label: "Продукт", num: 1 },
  { id: "settings", label: "Настройки", num: 2 },
  { id: "creative-type", label: "Креатив", num: 3 },
  { id: "generate", label: "Копи", num: 4 },
  { id: "visuals", label: "Визуали", num: 5 },
];

// --- Settings ---
const AVATARS = [
  { id: "Стефан (Performance Seeker, М 28-40)", label: "Стефан", tag: "М 28-40", emoji: "\ud83d\udcaa", desc: "Трениращ, удря плато. Иска данни и наука за натурален тестостерон." },
  { id: "Мария (Health-Conscious Parent, Ж 30-50)", label: "Мария", tag: "Ж 30-50", emoji: "\ud83d\udc69\u200d\ud83d\udc67", desc: "Защитава семейството. Проучва преди покупка, търси доверие." },
  { id: "Петър (Proactive Health Manager, М 35-55)", label: "Петър", tag: "М 35-55", emoji: "\ud83e\ude7a", desc: "Наскоро здравно-осъзнат. Скептичен, иска механизми и обяснения." },
  { id: "Елена (Beauty & Wellness, Ж 25-45)", label: "Елена", tag: "Ж 25-45", emoji: "\u2728", desc: "Външен вид + вътрешно здраве. Instagram-influenced, чисти съставки." },
  { id: "Георги (Loyal Repeater, М 40-65)", label: "Георги", tag: "М 40-65", emoji: "\ud83d\udd04", desc: "Лоялен клиент, купува месечно. Иска удобство и cross-sell." },
];
const FORMATS = [
  { id: "Meta Feed Ad", label: "Meta Feed" }, { id: "Instagram Stories/Reels", label: "Stories/Reels" },
  { id: "Google Ads", label: "Google Ads" }, { id: "Carousel (3-5 карти, PAS)", label: "Carousel" },
  { id: "Advertorial (дълга форма)", label: "Advertorial" }, { id: "Social Post", label: "Social Post" },
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
  { id: "Решение на проблем (каква болка да премахнем)", label: "Проблем \u2192 Решение" },
  { id: "Идентичност (кой искат да бъдат)", label: "Идентичност" },
  { id: "Социално доказателство (други вече го ползват)", label: "Social Proof" },
];
const CREATIVE_TYPES = [
  { id: "Продуктова снимка", label: "Продуктова снимка", desc: "Чист product shot на бял или стилизиран фон", icon: Camera },
  { id: "Научен / Инфо", label: "Научен / Инфо", desc: "Текстова карта с факти и статистики", icon: FileText },
  { id: "Lifestyle", label: "Lifestyle", desc: "Продуктът в контекст — фитнес, кухня, природа", icon: Sun },
  { id: "Lifestyle + текст", label: "Lifestyle + оверлей", desc: "Lifestyle с headline текст върху снимката", icon: Layers },
];
const INTENSITY_LABELS = ["Информативен", "Образователен", "Авторитетен", "Убеждаващ", "Директен"];

// --- Progress Bar ---
function ProgressBar({ current, onNavigate }: { current: Step; onNavigate: (s: Step) => void }) {
  const currentIdx = STEPS.findIndex((s) => s.id === current);
  return (
    <div className="flex items-center gap-1 mb-6 overflow-x-auto pb-2">
      {STEPS.map((s, i) => {
        const isCompleted = i < currentIdx;
        const isActive = s.id === current;
        return (
          <div key={s.id} className="flex items-center">
            <button
              onClick={() => isCompleted ? onNavigate(s.id) : undefined}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] font-medium transition-all min-h-[40px] ${
                isActive ? "bg-purple text-white shadow-sm" :
                isCompleted ? "bg-purple-soft text-purple cursor-pointer hover:bg-purple/20" :
                "bg-surface-2 text-text-3"
              }`}
            >
              {isCompleted ? <Check size={14} /> : <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[11px]">{s.num}</span>}
              <span className="whitespace-nowrap">{s.label}</span>
            </button>
            {i < STEPS.length - 1 && <ChevronRight size={14} className="text-text-3 mx-1 flex-shrink-0" />}
          </div>
        );
      })}
    </div>
  );
}

// --- Pill selector ---
function PillGroup<T extends string>({ options, value, onChange, label }: {
  options: { id: T; label: string }[]; value: T; onChange: (v: T) => void; label: string;
}) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wider text-text-3 mb-2">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <button key={opt.id} onClick={() => onChange(opt.id)}
            className={`px-3 py-2 rounded-xl text-[12px] font-medium transition-all cursor-pointer min-h-[40px] ${
              value === opt.id ? "bg-purple text-white shadow-sm" : "bg-surface-2 text-text-2 hover:bg-border/40"
            }`}
          >{opt.label}</button>
        ))}
      </div>
    </div>
  );
}

// --- Step 1: Product ---
function ProductStep({ selected, onSelect }: { selected: SlimProduct | null; onSelect: (p: SlimProduct) => void }) {
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
    if (search) { const q = search.toLowerCase(); products = products.filter((p) => p.title.toLowerCase().includes(q)); }
    return products;
  }, [data?.products, category, search]);

  return (
    <div>
      <h2 className="text-[18px] font-semibold text-text mb-1">Избери продукт</h2>
      <p className="text-[13px] text-text-3 mb-4">За кой продукт ще правим реклама?</p>

      <div className="space-y-3 mb-4">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Търси продукт..."
            className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-surface-2 border border-border text-[13px] text-text outline-none focus:border-purple"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <button onClick={() => setCategory("all")} className={`px-3 py-1.5 rounded-lg text-[11px] font-medium whitespace-nowrap cursor-pointer min-h-[34px] ${category === "all" ? "bg-purple text-white" : "bg-surface-2 text-text-3"}`}>Всички</button>
          {categories.map(([cat, count]) => (
            <button key={cat} onClick={() => setCategory(cat)} className={`px-3 py-1.5 rounded-lg text-[11px] font-medium whitespace-nowrap cursor-pointer min-h-[34px] ${category === cat ? "bg-purple text-white" : "bg-surface-2 text-text-3"}`}>{cat} ({count})</button>
          ))}
        </div>
      </div>

      {!data ? (
        <div className="flex items-center justify-center py-12 text-text-3"><Loader2 size={20} className="animate-spin mr-2" />Зареждам каталога...</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map((p) => (
            <button key={p.handle} onClick={() => onSelect(p)}
              className={`group bg-surface rounded-xl overflow-hidden text-left transition-all cursor-pointer border-2 ${
                selected?.handle === p.handle ? "border-purple ring-2 ring-purple/20" : "border-transparent hover:border-purple/30"
              }`}
            >
              {p.image ? (
                <img src={p.image} alt="" className="w-full aspect-square object-contain bg-surface-2" />
              ) : (
                <div className="w-full aspect-square bg-surface-2 flex items-center justify-center"><Package size={24} className="text-text-3" /></div>
              )}
              <div className="p-2.5">
                <div className="text-[11px] font-medium text-text line-clamp-2 leading-tight mb-1">{p.title}</div>
                <div className="text-[11px] font-semibold text-purple">{parseFloat(p.price).toFixed(2)} EUR</div>
              </div>
              {selected?.handle === p.handle && (
                <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-purple flex items-center justify-center"><Check size={14} className="text-white" /></div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Step 2: Settings ---
function SettingsStep({ avatar, setAvatar, format, setFormat, approach, setApproach, angle, setAngle, intensity, setIntensity }: {
  avatar: string; setAvatar: (v: string) => void; format: string; setFormat: (v: string) => void;
  approach: string; setApproach: (v: string) => void; angle: string; setAngle: (v: string) => void;
  intensity: number; setIntensity: (v: number) => void;
}) {
  return (
    <div>
      <h2 className="text-[18px] font-semibold text-text mb-1">Настрой кампанията</h2>
      <p className="text-[13px] text-text-3 mb-5">За кого е рекламата и в какъв формат?</p>

      <div className="space-y-5 max-w-2xl">
        {/* Avatar cards */}
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-text-3 mb-2">Аватар — за кого пишем?</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {AVATARS.map((a) => (
              <button key={a.id} onClick={() => setAvatar(a.id)}
                className={`flex items-start gap-2.5 p-3 rounded-xl text-left transition-all cursor-pointer ${
                  avatar === a.id ? "bg-purple/10 ring-2 ring-purple/40" : "bg-surface-2 hover:bg-border/30"
                }`}
              >
                <span className="text-[18px] mt-0.5">{a.emoji}</span>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[13px] font-semibold ${avatar === a.id ? "text-purple" : "text-text"}`}>{a.label}</span>
                    <span className="text-[10px] text-text-3">{a.tag}</span>
                  </div>
                  <p className="text-[11px] text-text-3 leading-snug mt-0.5">{a.desc}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        <PillGroup options={FORMATS} value={format} onChange={setFormat} label="Формат на рекламата" />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <PillGroup options={APPROACHES} value={approach} onChange={setApproach} label="Подход" />
          <PillGroup options={ANGLES} value={angle} onChange={setAngle} label="Емоционален ъгъл" />
        </div>

        <div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-text-3 mb-2">Интензивност: {intensity}/5 — {INTENSITY_LABELS[intensity - 1]}</div>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((level) => (
              <button key={level} onClick={() => setIntensity(level)} className={`flex-1 h-3 rounded-full transition-all cursor-pointer ${level <= intensity ? "bg-purple" : "bg-surface-2"}`} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Step 3: Creative Type ---
function CreativeTypeStep({ selected, onSelect }: { selected: string; onSelect: (v: string) => void }) {
  return (
    <div>
      <h2 className="text-[18px] font-semibold text-text mb-1">Тип креатив</h2>
      <p className="text-[13px] text-text-3 mb-5">Какъв визуален стил искаш?</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
        {CREATIVE_TYPES.map((ct) => {
          const Icon = ct.icon;
          const isSelected = selected === ct.id;
          return (
            <button key={ct.id} onClick={() => onSelect(ct.id)}
              className={`flex items-start gap-4 p-5 rounded-xl text-left transition-all cursor-pointer border-2 ${
                isSelected ? "border-purple bg-purple/5 ring-2 ring-purple/20" : "border-border bg-surface hover:border-purple/30"
              }`}
            >
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${isSelected ? "bg-purple text-white" : "bg-surface-2 text-text-2"}`}>
                <Icon size={22} />
              </div>
              <div>
                <div className={`text-[14px] font-semibold ${isSelected ? "text-purple" : "text-text"}`}>{ct.label}</div>
                <p className="text-[12px] text-text-3 mt-0.5">{ct.desc}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// --- Step 4: Generate Copy ---
function GenerateStep({ product, avatar, format, approach, angle, intensity, creativeType, generatedContent, setGeneratedContent, additionalInput, setAdditionalInput }: {
  product: SlimProduct; avatar: string; format: string; approach: string;
  angle: string; intensity: number; creativeType: string;
  generatedContent: string; setGeneratedContent: (v: string) => void;
  additionalInput: string; setAdditionalInput: (v: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const generate = useCallback(async () => {
    setLoading(true);
    setGeneratedContent("");

    const settingsContext = [
      `[Настройки: Аватар: ${AVATARS.find((a) => a.id === avatar)?.label}`,
      `Формат: ${FORMATS.find((f) => f.id === format)?.label}`,
      `Подход: ${APPROACHES.find((a) => a.id === approach)?.label}`,
      `Ъгъл: ${ANGLES.find((a) => a.id === angle)?.label}`,
      `Интензивност: ${intensity}/5`,
      `Продукт: ${product.title} (handle: ${product.handle})`,
      `Тип креатив: ${creativeType}]`,
    ].join(", ");

    const userMessage = additionalInput.trim()
      ? `${settingsContext}\n\n${additionalInput.trim()}`
      : `${settingsContext}\n\nСъздай 4 варианта на рекламно копи за този продукт с избраните настройки. Включи Image Prompt за всеки вариант.`;

    try {
      const res = await fetch("/api/agents/ad-creator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: userMessage }],
          avatar, format, approach, intensity, angle,
          product: product.handle,
          creativeType,
        }),
      });
      if (!res.ok) throw new Error("API error");

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

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
            if (evt.t === "text") { accumulated += evt.d; setGeneratedContent(accumulated); }
            if (evt.t === "replace") { accumulated = evt.content; setGeneratedContent(accumulated); }
          } catch { /* skip */ }
        }
      }
    } catch {
      setGeneratedContent("\u26a0\ufe0f Грешка при генериране. Опитай отново.");
    }
    setLoading(false);
  }, [product, avatar, format, approach, angle, intensity, creativeType, additionalInput, setGeneratedContent]);

  useEffect(() => {
    if (!generatedContent && !loading) generate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-[18px] font-semibold text-text mb-1">Рекламно копи</h2>
          <p className="text-[13px] text-text-3">4 варианта — избери любимите и продължи към визуали</p>
        </div>
        <button onClick={generate} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-2 hover:bg-border/40 text-[12px] font-medium text-text-2 cursor-pointer transition-all min-h-[40px]"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />{loading ? "Генерирам..." : "Регенерирай"}
        </button>
      </div>

      {/* Additional input */}
      <div className="mb-4">
        <input type="text" value={additionalInput} onChange={(e) => setAdditionalInput(e.target.value)}
          placeholder="Допълнителни инструкции (незадължително)..."
          className="w-full px-4 py-2.5 rounded-xl bg-surface-2 border border-border text-[13px] text-text outline-none focus:border-purple"
        />
      </div>

      {/* Generated content */}
      <div ref={contentRef} className="bg-surface rounded-xl border border-border p-5 min-h-[200px]">
        {loading && !generatedContent ? (
          <div className="flex items-center gap-3 text-text-3 py-8 justify-center">
            <Loader2 size={18} className="animate-spin" /><span className="text-[14px]">Създавам 4 варианта...</span>
          </div>
        ) : generatedContent ? (
          <div>
            <Markdown text={generatedContent} />
            {loading && <span className="inline-block w-1 h-4 bg-purple animate-pulse ml-0.5 rounded-sm" />}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// --- Step 5: Visuals ---
function VisualsStep({ generatedContent, format }: { generatedContent: string; format: string }) {
  const [images, setImages] = useState<{ prompt: string; image: string | null; loading: boolean; error: string | null }[]>([]);
  const [generating, setGenerating] = useState(false);

  // Extract image prompts from generated content
  const imagePrompts = useMemo(() => {
    const prompts: string[] = [];
    const regex = /\*\*Image Prompt \(EN\):\*\*\s*\n([^\n*]+(?:\n[^\n*#]+)*)/gi;
    let match;
    while ((match = regex.exec(generatedContent)) !== null) {
      const prompt = match[1].trim();
      if (prompt.length > 10) prompts.push(prompt);
    }
    return prompts;
  }, [generatedContent]);

  const generateAll = useCallback(async () => {
    if (imagePrompts.length === 0) return;
    setGenerating(true);
    setImages(imagePrompts.map((p) => ({ prompt: p, image: null, loading: true, error: null })));

    for (let i = 0; i < imagePrompts.length; i++) {
      try {
        const res = await fetch("/api/agents/ad-creator/generate-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: imagePrompts[i], format }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setImages((prev) => prev.map((img, j) => j === i ? { ...img, image: data.image, loading: false } : img));
      } catch (err) {
        setImages((prev) => prev.map((img, j) => j === i ? { ...img, loading: false, error: String(err) } : img));
      }
    }
    setGenerating(false);
  }, [imagePrompts, format]);

  useEffect(() => {
    if (imagePrompts.length > 0 && images.length === 0) generateAll();
  }, [imagePrompts]); // eslint-disable-line react-hooks/exhaustive-deps

  const downloadImage = (base64: string, index: number) => {
    const link = document.createElement("a");
    link.href = `data:image/png;base64,${base64}`;
    link.download = `cvetita-creative-${index + 1}.png`;
    link.click();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-[18px] font-semibold text-text mb-1">Визуали</h2>
          <p className="text-[13px] text-text-3">{imagePrompts.length} креатива от Gemini AI</p>
        </div>
        <button onClick={generateAll} disabled={generating}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-2 hover:bg-border/40 text-[12px] font-medium text-text-2 cursor-pointer transition-all min-h-[40px]"
        >
          <RefreshCw size={14} className={generating ? "animate-spin" : ""} />{generating ? "Генерирам..." : "Регенерирай"}
        </button>
      </div>

      {imagePrompts.length === 0 ? (
        <div className="text-center py-12 text-text-3">
          <Camera size={32} className="mx-auto mb-3 opacity-50" />
          <p className="text-[14px]">Не са открити Image Prompt-ове в копито.</p>
          <p className="text-[12px] mt-1">Върни се на стъпка 4 и регенерирай копито.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {images.map((img, i) => (
            <div key={i} className="bg-surface rounded-xl border border-border overflow-hidden">
              {img.loading ? (
                <div className="aspect-square flex items-center justify-center bg-surface-2">
                  <div className="text-center">
                    <Loader2 size={24} className="animate-spin mx-auto mb-2 text-purple" />
                    <p className="text-[12px] text-text-3">Генерирам вариант {i + 1}...</p>
                  </div>
                </div>
              ) : img.error ? (
                <div className="aspect-square flex items-center justify-center bg-surface-2">
                  <p className="text-[12px] text-red px-4 text-center">{img.error}</p>
                </div>
              ) : img.image ? (
                <img src={`data:image/png;base64,${img.image}`} alt={`Вариант ${i + 1}`} className="w-full aspect-square object-contain bg-white" />
              ) : null}
              <div className="p-3 flex items-center justify-between">
                <span className="text-[12px] font-medium text-text">Вариант {i + 1}</span>
                {img.image && (
                  <button onClick={() => downloadImage(img.image!, i)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple text-white text-[11px] font-medium cursor-pointer hover:bg-purple/90 transition-all"
                  >
                    <Download size={12} />Изтегли
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Main Wizard ---
export default function AdCreatorPage() {
  const [step, setStep] = useState<Step>("product");
  const [selectedProduct, setSelectedProduct] = useState<SlimProduct | null>(null);
  const [avatar, setAvatar] = useState(AVATARS[0].id);
  const [format, setFormat] = useState(FORMATS[0].id);
  const [approach, setApproach] = useState(APPROACHES[0].id);
  const [intensity, setIntensity] = useState(3);
  const [angle, setAngle] = useState(ANGLES[0].id);
  const [creativeType, setCreativeType] = useState(CREATIVE_TYPES[0].id);
  const [generatedContent, setGeneratedContent] = useState("");
  const [additionalInput, setAdditionalInput] = useState("");

  const canNext: Record<Step, boolean> = {
    product: !!selectedProduct,
    settings: true,
    "creative-type": true,
    generate: generatedContent.length > 50,
    visuals: false,
  };

  const nextStep = () => {
    const idx = STEPS.findIndex((s) => s.id === step);
    if (idx < STEPS.length - 1 && canNext[step]) setStep(STEPS[idx + 1].id);
  };
  const prevStep = () => {
    const idx = STEPS.findIndex((s) => s.id === step);
    if (idx > 0) setStep(STEPS[idx - 1].id);
  };
  const navigateTo = (s: Step) => {
    const targetIdx = STEPS.findIndex((st) => st.id === s);
    const currentIdx = STEPS.findIndex((st) => st.id === step);
    if (targetIdx < currentIdx) setStep(s);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-var(--topbar-height)-48px)]">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2 flex-shrink-0">
        <div className="w-9 h-9 rounded-xl bg-purple flex items-center justify-center flex-shrink-0">
          <PenTool size={16} className="text-white" />
        </div>
        <div>
          <h1 className="text-[16px] font-semibold text-text">Рекламен Творец</h1>
          <p className="text-[12px] text-text-3">Стъпка по стъпка до готов креатив</p>
        </div>
        {selectedProduct && step !== "product" && (
          <div className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-2">
            {selectedProduct.image && <img src={selectedProduct.image} alt="" className="w-6 h-6 rounded object-contain bg-white" />}
            <span className="text-[11px] font-medium text-text-2 max-w-[120px] truncate">{selectedProduct.title}</span>
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div className="flex-shrink-0">
        <ProgressBar current={step} onNavigate={navigateTo} />
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-y-auto min-h-0 pb-20">
        {step === "product" && <ProductStep selected={selectedProduct} onSelect={setSelectedProduct} />}
        {step === "settings" && (
          <SettingsStep avatar={avatar} setAvatar={setAvatar} format={format} setFormat={setFormat}
            approach={approach} setApproach={setApproach} angle={angle} setAngle={setAngle}
            intensity={intensity} setIntensity={setIntensity}
          />
        )}
        {step === "creative-type" && <CreativeTypeStep selected={creativeType} onSelect={setCreativeType} />}
        {step === "generate" && selectedProduct && (
          <GenerateStep product={selectedProduct} avatar={avatar} format={format} approach={approach}
            angle={angle} intensity={intensity} creativeType={creativeType}
            generatedContent={generatedContent} setGeneratedContent={setGeneratedContent}
            additionalInput={additionalInput} setAdditionalInput={setAdditionalInput}
          />
        )}
        {step === "visuals" && <VisualsStep generatedContent={generatedContent} format={format} />}
      </div>

      {/* Navigation buttons */}
      <div className="fixed bottom-0 left-0 right-0 md:left-[var(--sidebar-width)] bg-surface/95 backdrop-blur-sm border-t border-border p-4 flex items-center justify-between z-10">
        <button onClick={prevStep} disabled={step === "product"}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-medium min-h-[44px] transition-all ${
            step === "product" ? "text-text-3 cursor-not-allowed" : "bg-surface-2 text-text-2 hover:bg-border/40 cursor-pointer"
          }`}
        >
          <ChevronLeft size={16} />Назад
        </button>

        {step !== "visuals" ? (
          <button onClick={nextStep} disabled={!canNext[step]}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-[13px] font-medium min-h-[44px] transition-all ${
              canNext[step] ? "bg-purple text-white hover:bg-purple/90 cursor-pointer shadow-sm" : "bg-surface-2 text-text-3 cursor-not-allowed"
            }`}
          >
            Напред<ChevronRight size={16} />
          </button>
        ) : (
          <div className="text-[12px] text-text-3">Изтегли креативите или регенерирай</div>
        )}
      </div>
    </div>
  );
}
