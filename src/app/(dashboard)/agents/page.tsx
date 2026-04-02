"use client";

import Link from "next/link";
import { Megaphone, PenTool, MessageSquare, Sunrise, Bot } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";

const agents = [
  {
    href: "/agents/ads-intel",
    icon: Megaphone,
    color: "orange",
    name: "AI Стратег",
    subtitle: "Рекламен анализ и оптимизация",
    description: "Анализира Meta Ads данните ви — кампании, ad scores, фуния, ROAS. Препоръчва кои реклами да спрете, къде да преразпределите бюджет и как да подобрите performance.",
    audience: "За маркетинг мениджъри и media buyers",
    capabilities: ["Meta Ads анализ", "Performance scores", "Бюджетни препоръки", "Web Search"],
  },
  {
    href: "/agents/ad-creator",
    icon: PenTool,
    color: "purple",
    name: "AI Творец",
    subtitle: "Копирайтинг и креативна насока",
    description: "Създава рекламни текстове за Meta, Google, social media и advertorials. Познава продуктите, аватарите и балканската аудитория. Винаги дава 2 A/B варианта с визуална насока.",
    audience: "За копирайтъри, дизайнери и content creators",
    capabilities: ["Meta/Google Ads копи", "Продуктов каталог", "5 аватара", "Compliance филтър"],
  },
  {
    href: "/analysis",
    icon: MessageSquare,
    color: "accent",
    name: "Команден Чат",
    subtitle: "Бизнес асистент с пълен контекст",
    description: "Централен AI асистент с достъп до всички бизнес данни — продажби, трафик, имейли, реклами, клиенти. Задавайте въпроси и получавайте анализи базирани на реални числа.",
    audience: "За целия екип — мениджъри, анализатори, маркетинг",
    capabilities: ["Shopify данни", "GA4 трафик", "Klaviyo имейли", "Meta Ads", "Web Search"],
  },
  {
    href: "/morning-report",
    icon: Sunrise,
    color: "blue",
    name: "Сутрешен Доклад",
    subtitle: "Ежедневен бизнес обзор",
    description: "Автоматичен сутрешен доклад с вчерашните продажби, рекламен ROAS, трафик канали и имейл performance. Генерира 3 конкретни действия за деня.",
    audience: "За собственици и мениджъри — бърз старт на деня",
    capabilities: ["Вчерашни продажби", "Meta Ads ROAS", "GA4 трафик", "Klaviyo performance"],
  },
];

const colorMap: Record<string, { bg: string; icon: string; border: string; badge: string }> = {
  orange: { bg: "bg-orange-soft", icon: "text-orange", border: "hover:border-orange/30", badge: "bg-orange-soft text-orange" },
  purple: { bg: "bg-purple-soft", icon: "text-purple", border: "hover:border-purple/30", badge: "bg-purple-soft text-purple" },
  accent: { bg: "bg-accent-soft", icon: "text-accent", border: "hover:border-accent/30", badge: "bg-accent-soft text-accent" },
  blue: { bg: "bg-blue-soft", icon: "text-blue", border: "hover:border-blue/30", badge: "bg-blue-soft text-blue" },
};

export default function AgentsPage() {
  return (
    <>
      <PageHeader title="Агенти" />

      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-surface-2 flex items-center justify-center">
            <Bot size={20} className="text-text-2" />
          </div>
          <div>
            <p className="text-[14px] text-text-2">AI агенти с пълен бизнес контекст, продуктов каталог и Cvetita Herbal бранд знание.</p>
            <p className="text-[12px] text-text-3">Изберете агент за задачата, която искате да решите.</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {agents.map((agent) => {
          const colors = colorMap[agent.color];
          const Icon = agent.icon;
          return (
            <Link
              key={agent.href}
              href={agent.href}
              className={`group block bg-surface rounded-xl border border-border ${colors.border} shadow-sm hover:shadow-md transition-all p-5`}
            >
              <div className="flex items-start gap-4">
                <div className={`w-12 h-12 rounded-xl ${colors.bg} flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform`}>
                  <Icon size={22} className={colors.icon} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <h3 className="text-[15px] font-semibold text-text">{agent.name}</h3>
                  </div>
                  <p className="text-[12px] font-medium text-text-2 mb-2">{agent.subtitle}</p>
                  <p className="text-[13px] text-text-3 leading-relaxed mb-3">{agent.description}</p>
                  <p className="text-[11px] text-text-3 mb-3">{agent.audience}</p>
                  <div className="flex flex-wrap gap-1">
                    {agent.capabilities.map((cap) => (
                      <span key={cap} className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${colors.badge}`}>
                        {cap}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
