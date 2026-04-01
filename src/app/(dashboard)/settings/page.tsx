"use client";

import { Card, CardHeader, CardBody } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { PageHeader } from "@/components/shared/PageHeader";
import { Save } from "lucide-react";

export default function SettingsPage() {
  return (
    <>
    <PageHeader title="Настройки" />
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader>Бизнес профил</CardHeader>
        <CardBody className="space-y-4">
          <Field label="Компания" defaultValue="Цветита Хербал ЕООД" />
          <Field label="Сайт" placeholder="www.tsvetita-herbal.com" />
          <Field
            label="Имейл за доклади"
            placeholder="info@tsvetita-herbal.com"
            type="email"
          />
          <Field label="Месечен бюджет реклами" type="select">
            <option>Над 15 000 лв.</option>
            <option>5 000-15 000 лв.</option>
            <option>До 5 000 лв.</option>
          </Field>
          <Button className="w-full mt-2">
            <Save size={16} />
            Запази
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>Бизнес цели</CardHeader>
        <CardBody className="space-y-4">
          <Field label="Главна цел" type="select">
            <option>Повече продажби и нови клиенти</option>
            <option>По-нисък CPA</option>
            <option>По-висок ROAS</option>
          </Field>
          <Field label="Целеви пазари" type="select">
            <option>България + Румъния</option>
            <option>Само България</option>
            <option>Цяла Европа</option>
          </Field>
          <Field
            label="Топ продукти"
            type="textarea"
            placeholder="Ашваганда, Куркума, Магнезий..."
          />
          <Field
            label="Конкуренти за следене"
            type="textarea"
            placeholder="Gymbeam, Myprotein, Superlab..."
          />
        </CardBody>
      </Card>
    </div>
    </>
  );
}

function Field({
  label,
  type = "text",
  defaultValue,
  placeholder,
  children,
}: {
  label: string;
  type?: string;
  defaultValue?: string;
  placeholder?: string;
  children?: React.ReactNode;
}) {
  const inputClasses =
    "w-full bg-surface-2 border border-border rounded-lg px-3 py-2.5 text-[14px] text-text outline-none focus:border-accent transition-colors placeholder:text-text-3";

  return (
    <div>
      <label className="block text-[11px] font-medium uppercase tracking-wider text-text-3 mb-1.5">
        {label}
      </label>
      {type === "select" ? (
        <select className={inputClasses + " cursor-pointer"} defaultValue={defaultValue}>
          {children}
        </select>
      ) : type === "textarea" ? (
        <textarea
          className={inputClasses + " min-h-[80px] resize-y"}
          placeholder={placeholder}
          defaultValue={defaultValue}
        />
      ) : (
        <input
          type={type}
          className={inputClasses}
          defaultValue={defaultValue}
          placeholder={placeholder}
        />
      )}
    </div>
  );
}
