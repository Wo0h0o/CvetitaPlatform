import { Card, CardHeader, CardBody } from "@/components/shared/Card";

const categories = [
  { label: "Витамини", trend: "Горещо", pct: 82, color: "bg-accent" },
  { label: "Билкови", trend: "Ръст", pct: 68, color: "bg-teal-500" },
  { label: "Протеини", trend: "Стабилно", pct: 55, color: "bg-blue" },
  { label: "Детокс", trend: "Сезон", pct: 75, color: "bg-orange" },
];

export function MarketPulse() {
  return (
    <Card>
      <CardHeader>Пазарен пулс</CardHeader>
      <CardBody>
        <div className="grid grid-cols-2 gap-3">
          {categories.map((cat) => (
            <div
              key={cat.label}
              className="bg-surface-2 rounded-lg p-3.5"
            >
              <div className="text-[12px] text-text-3 mb-1.5">{cat.label}</div>
              <div className="text-[15px] font-semibold text-text mb-2">
                {cat.trend}
              </div>
              <div className="h-1 bg-border rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${cat.color} transition-all duration-700`}
                  style={{ width: `${cat.pct}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
