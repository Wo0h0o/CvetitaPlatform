"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, PenTool, Loader2, ExternalLink, ChevronDown, ChevronUp, Globe, Settings2 } from "lucide-react";
import { Card } from "@/components/shared/Card";
import { Markdown } from "@/components/shared/Markdown";

// --- Types ---
interface UserMessage { role: "user"; content: string }
interface AssistantMessage { role: "assistant"; content: string; sources?: { title: string; url: string }[]; searches?: string[]; tools?: string[] }
interface StatusMessage { role: "status"; msg: string }
type Message = UserMessage | AssistantMessage | StatusMessage;

// --- Settings ---
const AVATARS = [
  { id: "Стефан (Performance Seeker, М 28-40)", label: "Стефан", desc: "М 28-40, трениращ" },
  { id: "Мария (Health-Conscious Parent, Ж 30-50)", label: "Мария", desc: "Ж 30-50, семейство" },
  { id: "Петър (Proactive Health Manager, М 35-55)", label: "Петър", desc: "М 35-55, здравно-осъзнат" },
  { id: "Елена (Beauty & Wellness, Ж 25-45)", label: "Елена", desc: "Ж 25-45, красота" },
  { id: "Георги (Loyal Repeater, М 40-65)", label: "Георги", desc: "М 40-65, лоялен" },
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
  "Напиши Meta реклама за Tribulus Max",
  "Създай 3 hook варианта за Collagen Smoothie",
  "Помогни ми с launch кампания за нов продукт",
  "Какви продукти имаме за имунитет?",
  "Направи Google Ads copy за TLZ Body комбото",
  "Създай Instagram carousel за витамин D",
];

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

// --- Pill selector ---
function PillGroup<T extends string>({ options, value, onChange, label }: {
  options: { id: T; label: string; desc?: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wider text-text-3 mb-1.5">{label}</div>
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            title={opt.desc}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-all cursor-pointer ${
              value === opt.id
                ? "bg-purple text-white shadow-sm"
                : "text-text-3 hover:text-text-2 hover:bg-surface-2 border border-transparent hover:border-border"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// --- Intensity slider ---
function IntensitySlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const labels = ["Информативен", "Образователен", "Авторитетен", "Убеждаващ", "Директен"];
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wider text-text-3 mb-1.5">
        Интензивност: {value}/5 — {labels[value - 1]}
      </div>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((level) => (
          <button
            key={level}
            onClick={() => onChange(level)}
            className={`flex-1 h-2 rounded-full transition-all cursor-pointer ${
              level <= value ? "bg-purple" : "bg-surface-2"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

// --- Main page ---
export default function AdCreatorPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(true);

  // Settings
  const [avatar, setAvatar] = useState(AVATARS[0].id);
  const [format, setFormat] = useState(FORMATS[0].id);
  const [approach, setApproach] = useState(APPROACHES[0].id);
  const [intensity, setIntensity] = useState(3);
  const [angle, setAngle] = useState(ANGLES[0].id);

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const userScrolledUp = useRef(false);

  useEffect(() => {
    if (!userScrolledUp.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, searchQuery]);

  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      userScrolledUp.current = distanceFromBottom > 150;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const send = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;
    setInput("");
    setLoading(true);
    setSearchQuery(null);
    setShowSettings(false);
    userScrolledUp.current = false;

    const userMsg: UserMessage = { role: "user", content: text.trim() };
    const conversationHistory = [
      ...messages.filter((m): m is UserMessage | AssistantMessage => m.role === "user" || m.role === "assistant"),
      userMsg,
    ];
    setMessages((prev) => [...prev, userMsg]);

    const assistantPlaceholder: AssistantMessage = { role: "assistant", content: "", sources: [], searches: [], tools: [] };
    setMessages((prev) => [...prev, assistantPlaceholder]);

    try {
      const res = await fetch("/api/agents/ad-creator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: conversationHistory.map((m) => ({ role: m.role, content: m.content })),
          avatar, format, approach, intensity, angle,
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
                  const withoutLast = filtered.slice(0, -1);
                  return [...withoutLast, { role: "status", msg: evt.msg }, last];
                }
                return filtered;
              });
            }
            if (evt.t === "tool") {
              updateLast((m) => ({ ...m, tools: [...(m.tools ?? []), evt.label] }));
            }
            if (evt.t === "search") {
              setSearchQuery(evt.q);
              updateLast((m) => ({ ...m, searches: [...(m.searches ?? []), evt.q] }));
            }
            if (evt.t === "sources") {
              setSearchQuery(null);
              updateLast((m) => ({ ...m, sources: [...(m.sources ?? []), ...evt.results] }));
            }
            if (evt.t === "text") updateLast((m) => ({ ...m, content: m.content + evt.d }));
            if (evt.t === "done") {
              setSearchQuery(null);
              setMessages((prev) => prev.filter((m) => m.role !== "status"));
            }
            if (evt.t === "error") updateLast((m) => ({ ...m, content: `⚠️ ${evt.msg}` }));
          } catch { /* skip */ }
        }
      }
    } catch {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "assistant") (last as AssistantMessage).content = "⚠️ Грешка при свързване с агента. Опитайте отново.";
        return next;
      });
    }

    setLoading(false);
    setSearchQuery(null);
    inputRef.current?.focus();
  }, [loading, messages, avatar, format, approach, intensity, angle]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col h-[calc(100vh-var(--topbar-height)-48px)] max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-xl bg-purple flex items-center justify-center flex-shrink-0">
          <PenTool size={16} className="text-white" />
        </div>
        <div>
          <h1 className="text-[16px] font-semibold text-text">Рекламен Творец</h1>
          <p className="text-[12px] text-text-3">Копирайтинг · Реклами · Визуална насока · Claude Sonnet</p>
        </div>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className={`ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full transition-colors cursor-pointer ${
            showSettings ? "bg-purple-soft text-purple" : "bg-surface-2 text-text-3 hover:text-text-2"
          }`}
        >
          <Settings2 size={12} />
          <span className="text-[11px] font-medium">Настройки</span>
        </button>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="bg-surface border border-border rounded-xl p-4 mb-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <PillGroup options={AVATARS} value={avatar} onChange={setAvatar} label="Аватар" />
            <PillGroup options={FORMATS} value={format} onChange={setFormat} label="Формат" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <PillGroup options={APPROACHES} value={approach} onChange={setApproach} label="Подход" />
            <PillGroup options={ANGLES} value={angle} onChange={setAngle} label="Емоционален ъгъл" />
          </div>
          <IntensitySlider value={intensity} onChange={setIntensity} />
        </div>
      )}

      {/* Chat area */}
      <div ref={scrollAreaRef} className="flex-1 overflow-y-auto min-h-0">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full pb-8">
            <div className="w-16 h-16 rounded-2xl bg-purple-soft flex items-center justify-center mb-5">
              <PenTool size={28} className="text-purple" />
            </div>
            <h2 className="text-[20px] font-semibold text-text mb-2">Рекламен Творец</h2>
            <p className="text-[13px] text-text-3 text-center mb-8 max-w-sm">
              Създавам рекламни текстове, адвертори и креативни насоки, съобразени с Cvetita Herbal бранда, продуктите и балканската аудитория.
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
              if (msg.role === "status") {
                return (
                  <div key={i} className="flex items-center gap-2 px-2 text-text-3">
                    <Loader2 size={12} className="animate-spin flex-shrink-0" />
                    <span className="text-[12px]">{msg.msg}</span>
                  </div>
                );
              }
              if (msg.role === "user") {
                return (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-tr-sm bg-purple text-white text-[14px] leading-relaxed">{msg.content}</div>
                  </div>
                );
              }
              const am = msg as AssistantMessage;
              const isStreaming = loading && i === messages.length - 1;
              return (
                <div key={i} className="flex gap-3">
                  <div className="w-7 h-7 rounded-lg bg-purple-soft flex items-center justify-center flex-shrink-0 mt-0.5">
                    <PenTool size={13} className="text-purple" />
                  </div>
                  <div className="flex-1 min-w-0">
                    {/* Tool chips */}
                    {am.tools && am.tools.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {am.tools.map((t, ti) => (
                          <span key={ti} className="px-2 py-0.5 rounded-full bg-purple-soft text-[10px] font-medium text-purple">{t}</span>
                        ))}
                      </div>
                    )}
                    {/* Search chips */}
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
      <div className="mt-3">
        <div className="flex gap-2 items-end bg-surface border border-border rounded-2xl p-2 focus-within:border-purple/50 transition-colors shadow-sm">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Какво копи ти трябва? Продукт, аватар, формат..."
            rows={1}
            disabled={loading}
            className="flex-1 bg-transparent text-[14px] text-text placeholder-text-3 outline-none resize-none py-1.5 px-2 max-h-32 min-h-[36px]"
            style={{ fieldSizing: "content" } as React.CSSProperties}
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || loading}
            className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 transition-all cursor-pointer ${
              input.trim() && !loading ? "bg-purple hover:bg-purple/90 text-white shadow-sm" : "bg-surface-2 text-text-3 cursor-not-allowed"
            }`}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
        <p className="text-[11px] text-text-3 text-center mt-2">Enter за изпращане · Shift+Enter за нов ред · Claude Sonnet + Продуктов каталог</p>
      </div>
    </div>
  );
}
