"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { PageHeader } from "@/components/shared/PageHeader";
import { Skeleton } from "@/components/shared/Skeleton";
import { useToast } from "@/providers/ToastProvider";
import { Save, Building2, Target, CheckCircle, AlertCircle, XCircle, Wifi } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface BusinessSettings {
  company?: string;
  website?: string;
  reportEmail?: string;
  monthlyBudget?: string;
  mainGoal?: string;
  targetMarkets?: string;
  topProducts?: string;
  competitors?: string;
}

export default function SettingsPage() {
  const { toast } = useToast();
  const { data, isLoading, mutate } = useSWR<{ orgName: string; settings: BusinessSettings }>(
    "/api/settings",
    fetcher,
    { revalidateOnFocus: false }
  );

  const [form, setForm] = useState<BusinessSettings>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Populate form when data loads
  useEffect(() => {
    if (data?.settings) {
      setForm({
        company: data.settings.company || data.orgName || "",
        website: data.settings.website || "",
        reportEmail: data.settings.reportEmail || "",
        monthlyBudget: data.settings.monthlyBudget || "Над 15 000 лв.",
        mainGoal: data.settings.mainGoal || "Повече продажби и нови клиенти",
        targetMarkets: data.settings.targetMarkets || "България + Румъния",
        topProducts: data.settings.topProducts || "",
        competitors: data.settings.competitors || "",
      });
      setDirty(false);
    }
  }, [data]);

  const updateField = (key: keyof BusinessSettings, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const handleSave = async () => {
    // Validation
    if (form.reportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.reportEmail)) {
      toast("Невалиден имейл адрес", "error");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: form }),
      });

      if (!res.ok) throw new Error("Failed");

      const result = await res.json();
      mutate({ orgName: data?.orgName || "", settings: result.settings }, false);
      setDirty(false);
      toast("Настройките са запазени", "success");
    } catch {
      toast("Грешка при запазване", "error");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <>
        <PageHeader title="Настройки" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card><CardBody className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i}><Skeleton className="h-4 w-20 mb-1.5" /><Skeleton className="h-10 w-full" /></div>
            ))}
          </CardBody></Card>
          <Card><CardBody className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i}><Skeleton className="h-4 w-20 mb-1.5" /><Skeleton className="h-10 w-full" /></div>
            ))}
          </CardBody></Card>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Настройки">
        {dirty && (
          <span className="text-[12px] text-orange font-medium">Незапазени промени</span>
        )}
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Business Profile */}
        <Card>
          <CardHeader action={<Building2 size={16} className="text-text-3" />}>
            Бизнес профил
          </CardHeader>
          <CardBody className="space-y-4">
            <Field
              label="Компания"
              value={form.company || ""}
              onChange={(v) => updateField("company", v)}
            />
            <Field
              label="Сайт"
              value={form.website || ""}
              onChange={(v) => updateField("website", v)}
              placeholder="www.tsvetita-herbal.com"
            />
            <Field
              label="Имейл за доклади"
              value={form.reportEmail || ""}
              onChange={(v) => updateField("reportEmail", v)}
              placeholder="info@tsvetita-herbal.com"
              type="email"
            />
            <Field
              label="Месечен бюджет реклами"
              value={form.monthlyBudget || "Над 15 000 лв."}
              onChange={(v) => updateField("monthlyBudget", v)}
              type="select"
              options={["Над 15 000 лв.", "5 000-15 000 лв.", "До 5 000 лв."]}
            />
            <Button
              className="w-full mt-2"
              onClick={handleSave}
              disabled={saving || !dirty}
            >
              {saving ? (
                <>Запазване...</>
              ) : (
                <><Save size={16} /> Запази</>
              )}
            </Button>
          </CardBody>
        </Card>

        {/* Business Goals */}
        <Card>
          <CardHeader action={<Target size={16} className="text-text-3" />}>
            Бизнес цели
          </CardHeader>
          <CardBody className="space-y-4">
            <Field
              label="Главна цел"
              value={form.mainGoal || "Повече продажби и нови клиенти"}
              onChange={(v) => updateField("mainGoal", v)}
              type="select"
              options={["Повече продажби и нови клиенти", "По-нисък CPA", "По-висок ROAS"]}
            />
            <Field
              label="Целеви пазари"
              value={form.targetMarkets || "България + Румъния"}
              onChange={(v) => updateField("targetMarkets", v)}
              type="select"
              options={["България + Румъния", "Само България", "Цяла Европа"]}
            />
            <Field
              label="Топ продукти"
              value={form.topProducts || ""}
              onChange={(v) => updateField("topProducts", v)}
              type="textarea"
              placeholder="Ашваганда, Куркума, Магнезий..."
            />
            <Field
              label="Конкуренти за следене"
              value={form.competitors || ""}
              onChange={(v) => updateField("competitors", v)}
              type="textarea"
              placeholder="Gymbeam, Myprotein, Superlab..."
            />
          </CardBody>
        </Card>

        {/* Integration Status */}
        <Card className="lg:col-span-2">
          <CardHeader action={<Wifi size={16} className="text-text-3" />}>
            Свързани интеграции
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <IntegrationBadge name="Shopify" status="connected" />
              <IntegrationBadge name="Google Analytics" status="unknown" />
              <IntegrationBadge name="Meta Ads" status="unknown" />
              <IntegrationBadge name="Klaviyo" status="unknown" />
              <IntegrationBadge name="Google Ads" status="disconnected" />
            </div>
            <p className="text-[11px] text-text-3 mt-3">Статусът се определя от конфигурацията в Vercel Environment Variables.</p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

// ---------- Field Component ----------

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "select" | "textarea";
  placeholder?: string;
  options?: string[];
}) {
  const inputClasses =
    "w-full bg-surface-2 border border-border rounded-lg px-3 py-2.5 text-[14px] text-text outline-none focus:border-accent transition-colors placeholder:text-text-3";

  return (
    <div>
      <label className="block text-[13px] font-semibold text-text mb-1.5">
        {label}
      </label>
      {type === "select" && options ? (
        <select
          className={inputClasses + " cursor-pointer"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : type === "textarea" ? (
        <textarea
          className={inputClasses + " min-h-[80px] resize-y"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <input
          type={type}
          className={inputClasses}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
    </div>
  );
}

// ---------- Integration Badge ----------

function IntegrationBadge({ name, status }: { name: string; status: "connected" | "unknown" | "disconnected" }) {
  const styles = {
    connected: { border: "border-accent/20 bg-accent-soft", icon: CheckCircle, iconColor: "text-accent", text: "text-text" },
    unknown: { border: "border-orange/20 bg-orange-soft", icon: AlertCircle, iconColor: "text-orange", text: "text-text" },
    disconnected: { border: "border-border bg-surface-2", icon: XCircle, iconColor: "text-text-3", text: "text-text-3" },
  };
  const s = styles[status];
  return (
    <div className={`flex items-center gap-2 p-3 rounded-lg border ${s.border}`}>
      <s.icon size={16} className={s.iconColor} />
      <span className={`text-[13px] font-medium ${s.text}`}>{name}</span>
    </div>
  );
}
