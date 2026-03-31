import { Card } from "@/components/shared/Card";
import {
  BarChart3,
  Mail,
  MapPin,
  Globe,
  Palette,
  Sunrise,
} from "lucide-react";
import { ArrowUpRight } from "lucide-react";

const agents = [
  {
    icon: BarChart3,
    name: "Маркетинг Експерт",
    description: "Дневен анализ на Meta, Google, SEO и Email кампании",
    color: "text-accent",
    bg: "bg-accent-soft",
  },
  {
    icon: Mail,
    name: "Имейл Асистент",
    description: "Klaviyo кампании, flow-ве, шаблони и аудитории",
    color: "text-blue",
    bg: "bg-blue-soft",
  },
  {
    icon: MapPin,
    name: "Пазар България",
    description: "Конкуренти, тенденции, регулации в БГ",
    color: "text-orange",
    bg: "bg-orange-soft",
  },
  {
    icon: Globe,
    name: "Пазар Европа",
    description: "Анализ на 8 пазара, стратегии за експанзия",
    color: "text-blue",
    bg: "bg-blue-soft",
  },
  {
    icon: Palette,
    name: "Инфографики",
    description: "PDF инфографики от данни за секунди",
    color: "text-purple-500",
    bg: "bg-purple-500/10",
  },
  {
    icon: Sunrise,
    name: "Сутрешен Доклад",
    description: "AI доклад с новини, конкуренти и възможности",
    color: "text-orange",
    bg: "bg-orange-soft",
  },
];

export default function AgentsPage() {
  return (
    <>
      <p className="text-text-2 text-[14px] mb-6">
        Специализирани AI агенти за различни маркетинг задачи
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {agents.map((agent) => (
          <Card key={agent.name} hover>
            <div className="p-5">
              <div className="flex items-start justify-between mb-4">
                <div className={`w-10 h-10 rounded-xl ${agent.bg} flex items-center justify-center`}>
                  <agent.icon size={20} className={agent.color} />
                </div>
                <ArrowUpRight size={16} className="text-text-3" />
              </div>
              <h3 className="text-[15px] font-semibold text-text mb-1">
                {agent.name}
              </h3>
              <p className="text-[13px] text-text-2 leading-relaxed">
                {agent.description}
              </p>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
