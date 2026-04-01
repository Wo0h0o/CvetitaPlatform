"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Megaphone, Loader2, ExternalLink, ChevronDown, ChevronUp, Globe } from "lucide-react";
import { Card } from "@/components/shared/Card";
import { Markdown } from "@/components/shared/Markdown";

// --- Types ---
interface UserMessage { role: "user"; content: string }
interface AssistantMessage { role: "assistant"; content: string; sources?: { title: string; url: string }[]; searches?: string[] }
interface StatusMessage { role: "status"; msg: string }
type Message = UserMessage | AssistantMessage | StatusMessage;

// --- Suggested questions ---
const SUGGESTIONS = [
  "Кои реклами трябва да спра?",
  "Къде тече рекламната ни фуния?",
  "Видео или статични реклами работят по-добре?",
  "Как да разпределим бюджета тази седмица?",
  "Анализирай топ 3 и дъно 3 рекламите ни",
  "Какъв ROAS имаме реално спрямо Shopify приходите?",
];

// MarkdownText now uses shared Markdown component

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
              <ExternalLink size={11} className="text-text-3 mt-0.5 flex-shrink-0 group-hover:text-accent" />
              <span className="text-[11px] text-text-2 group-hover:text-accent line-clamp-1 leading-tight">{s.title || s.url}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Main page ---
export default function AdsIntelPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
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

  const send = async (text: string) => {
    if (!text.trim() || loading) return;
    setInput("");
    setLoading(true);
    setSearchQuery(null);
    userScrolledUp.current = false;

    const userMsg: UserMessage = { role: "user", content: text.trim() };
    const conversationHistory = [
      ...messages.filter((m): m is UserMessage | AssistantMessage => m.role === "user" || m.role === "assistant"),
      userMsg,
    ];
    setMessages((prev) => [...prev, userMsg]);

    const assistantPlaceholder: AssistantMessage = { role: "assistant", content: "", sources: [], searches: [] };
    setMessages((prev) => [...prev, assistantPlaceholder]);

    try {
      const res = await fetch("/api/agents/ads-intel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: conversationHistory.map((m) => ({ role: m.role, content: m.content })) }),
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
            if (evt.t === "error") updateLast((m) => ({ ...m, content: `\u26a0\ufe0f ${evt.msg}` }));
          } catch { /* skip */ }
        }
      }
    } catch {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "assistant") (last as AssistantMessage).content = "\u26a0\ufe0f Грешка при свързване с агента. Опитайте отново.";
        return next;
      });
    }

    setLoading(false);
    setSearchQuery(null);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col h-[calc(100vh-var(--topbar-height)-48px)] max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-xl bg-orange flex items-center justify-center flex-shrink-0">
          <Megaphone size={16} className="text-white" />
        </div>
        <div>
          <h1 className="text-[16px] font-semibold text-text">Рекламен Стратег</h1>
          <p className="text-[12px] text-text-3">Анализ на реклами · Performance scores · Claude Opus</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-orange-soft">
          <span className="w-1.5 h-1.5 rounded-full bg-orange animate-pulse" />
          <span className="text-[11px] font-medium text-orange">Активен</span>
        </div>
      </div>

      {/* Chat area */}
      <div ref={scrollAreaRef} className="flex-1 overflow-y-auto min-h-0">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full pb-8">
            <div className="w-16 h-16 rounded-2xl bg-orange-soft flex items-center justify-center mb-5">
              <Megaphone size={28} className="text-orange" />
            </div>
            <h2 className="text-[20px] font-semibold text-text mb-2">Рекламен анализ с AI</h2>
            <p className="text-[13px] text-text-3 text-center mb-8 max-w-sm">
              Имам достъп до всичките ви Meta Ads данни — кампании, реклами, scores, фуния.
              Питай ме за оптимизация, бюджет, creatives.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="text-left px-4 py-3 rounded-xl bg-surface border border-border hover:border-orange/40 hover:bg-orange-soft/30 transition-all text-[13px] text-text-2 hover:text-text cursor-pointer">
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
                    <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-tr-sm bg-orange text-white text-[14px] leading-relaxed">{msg.content}</div>
                  </div>
                );
              }
              const am = msg as AssistantMessage;
              const isStreaming = loading && i === messages.length - 1;
              return (
                <div key={i} className="flex gap-3">
                  <div className="w-7 h-7 rounded-lg bg-orange-soft flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Megaphone size={13} className="text-orange" />
                  </div>
                  <div className="flex-1 min-w-0">
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
                          {isStreaming && <span className="inline-block w-1 h-4 bg-orange animate-pulse ml-0.5 rounded-sm" />}
                          <SourceCard sources={am.sources ?? []} />
                        </div>
                      </Card>
                    ) : isStreaming ? (
                      <div className="flex items-center gap-2 text-text-3 py-2">
                        <Loader2 size={14} className="animate-spin" /><span className="text-[13px]">Анализирам рекламите...</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {searchQuery && (
              <div className="flex items-center gap-2 px-2">
                <div className="w-7 h-7 rounded-lg bg-orange-soft flex items-center justify-center flex-shrink-0">
                  <Globe size={13} className="text-orange animate-pulse" />
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
        <div className="flex gap-2 items-end bg-surface border border-border rounded-2xl p-2 focus-within:border-orange/50 transition-colors shadow-sm">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Питай за реклами, бюджет, creatives, фуния..."
            rows={1}
            disabled={loading}
            className="flex-1 bg-transparent text-[14px] text-text placeholder-text-3 outline-none resize-none py-1.5 px-2 max-h-32 min-h-[36px]"
            style={{ fieldSizing: "content" } as React.CSSProperties}
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || loading}
            className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 transition-all cursor-pointer ${
              input.trim() && !loading ? "bg-orange hover:bg-orange/90 text-white shadow-sm" : "bg-surface-2 text-text-3 cursor-not-allowed"
            }`}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
        <p className="text-[11px] text-text-3 text-center mt-2">Enter за изпращане · Shift+Enter за нов ред · Claude Opus + Web Search</p>
      </div>
    </div>
  );
}
