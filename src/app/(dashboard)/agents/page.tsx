import { Card } from "@/components/shared/Card";
import { Badge } from "@/components/shared/Badge";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  BarChart3,
  Mail,
  MapPin,
  Globe,
  Palette,
  Sunrise,
  Megaphone,
  ShoppingBag,
  ArrowUpRight,
} from "lucide-react";
import Link from "next/link";

type Status = "active" | "soon" | "planned";

const statusConfig: Record<Status, { label: string; variant: "green" | "blue" | "neutral" }> = {
  active: { label: "Активно", variant: "green" },
  soon: { label: "Скоро", variant: "blue" },
  planned: { label: "Планирано", variant: "neutral" },
};

const agents: {
  icon: React.ElementType;
  name: string;
  description: string;
  status: Status;
  href?: string;
  color: string;
  bg: string;
}[] = [
  {
    icon: BarChart3,
    name: "AI Пазарен Анализ",
    description: "6 типа анализи с Claude — конкуренти, пазари, реклама, възможности",
    status: "active",
    href: "/analysis",
    color: "text-accent",
    bg: "bg-accent-soft",
  },
  {
    icon: ShoppingBag,
    name: "Продуктов Анализ",
    description: "Топ продукти, upsell комбинации, AOV по продукт от Shopify",
    status: "active",
    href: "/products",
    color: "text-accent",
    bg: "bg-accent-soft",
  },
  {
    icon: Mail,
    name: "Имейл Dashboard",
    description: "Klaviyo абонати, flow-ве, кампании и performance метрики",
    status: "active",
    href: "/email",
    color: "text-blue",
    bg: "bg-blue-soft",
  },
  {
    icon: BarChart3,
    name: "Трафик & SEO",
    description: "GA4 канали, устройства, топ страници и engagement",
    status: "active",
    href: "/traffic",
    color: "text-blue",
    bg: "bg-blue-soft",
  },
  {
    icon: Megaphone,
    name: "Рекламен Стратег",
    description: "AI анализ на реклами · scores, фуния, бюджет, creatives · Claude Opus",
    status: "active",
    href: "/agents/ads-intel",
    color: "text-orange",
    bg: "bg-orange-soft",
  },
  {
    icon: MapPin,
    name: "Пазарен Разузнавач",
    description: "Реално търсене в интернет · конкуренти, тенденции, възможности · Claude Opus",
    status: "active",
    href: "/agents/market-intel",
    color: "text-blue",
    bg: "bg-blue-soft",
  },
  {
    icon: Globe,
    name: "Пазар Европа",
    description: "Анализ на 8 пазара, стратегии за експанзия в ЕС",
    status: "soon",
    color: "text-orange",
    bg: "bg-orange-soft",
  },
  {
    icon: Palette,
    name: "Инфографики",
    description: "Автоматично генериране на PDF инфографики от данни",
    status: "planned",
    color: "text-purple-500",
    bg: "bg-purple-500/10",
  },
  {
    icon: Sunrise,
    name: "Сутрешен Доклад",
    description: "AI доклад с реални данни от Shopify, Meta Ads, GA4, Klaviyo",
    status: "active",
    href: "/morning-report",
    color: "text-accent",
    bg: "bg-accent-soft",
  },
];

export default function AgentsPage() {
  return (
    <>
      <PageHeader title="Агенти" />
      <p className="text-text-2 text-[14px] mb-6">
        Модули на платформата — активни, в разработка и планирани
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {agents.map((agent) => {
          const status = statusConfig[agent.status];
          const isActive = agent.status === "active" && agent.href;
          const inner = (
              <Card
                hover={!!isActive}
                className={!isActive ? "opacity-75" : ""}
              >
                <div className="p-5">
                  <div className="flex items-start justify-between mb-4">
                    <div className={`w-10 h-10 rounded-xl ${agent.bg} flex items-center justify-center`}>
                      <agent.icon size={20} className={agent.color} />
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={status.variant}>{status.label}</Badge>
                      {isActive && <ArrowUpRight size={14} className="text-text-3" />}
                    </div>
                  </div>
                  <h3 className="text-[15px] font-semibold text-text mb-1">
                    {agent.name}
                  </h3>
                  <p className="text-[13px] text-text-2 leading-relaxed">
                    {agent.description}
                  </p>
                </div>
              </Card>
          );

          return isActive ? (
            <Link key={agent.name} href={agent.href!}>{inner}</Link>
          ) : (
            <div key={agent.name}>{inner}</div>
          );
        })}
      </div>
    </>
  );
}
