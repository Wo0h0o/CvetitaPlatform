"use client";

import useSWR from "swr";
import Link from "next/link";
import { BadgeCheck, Plus, Loader2, FileText } from "lucide-react";
import { Card } from "@/components/shared/Card";
import { PageHeader } from "@/components/shared/PageHeader";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Product {
  id: number;
  name: string;
  product_type: string;
  action: string;
  reg_number: string;
  updated_at: string;
}

export default function NotifyPage() {
  const { data, isLoading } = useSWR<{ products: Product[] }>("/api/notify/products", fetcher, {
    revalidateOnFocus: false,
  });
  const products = data?.products ?? [];

  return (
    <div>
      <PageHeader
        title={
          <>
            <BadgeCheck size={22} className="text-accent" /> Уведомления — продукти
          </>
        }
      >
        <Link
          href="/notify/product"
          className="flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg bg-accent text-white hover:opacity-90 cursor-pointer"
        >
          <Plus size={16} /> Нов продукт
        </Link>
      </PageHeader>

      <p className="text-[13px] text-text-3 mb-5">
        Изготвяне на документите за пускане на продукт на пазара (БАБХ): проекто-етикет, списък и заявление.
        Съставът, латинските имена и референтните стойности се попълват от базата — с минимум писане.
      </p>

      {isLoading && (
        <div className="flex items-center gap-2 text-text-3 py-12 justify-center">
          <Loader2 className="animate-spin" size={18} /> Зареждане…
        </div>
      )}

      {!isLoading && products.length === 0 && (
        <Card className="p-6 text-[14px] text-text-2">
          Още няма продукти. Създай първия с бутона <b>Нов продукт</b>.
        </Card>
      )}

      {products.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-text-3">
                <th className="text-left font-medium px-4 py-2.5">Продукт</th>
                <th className="text-left font-medium px-4 py-2.5">Тип</th>
                <th className="text-left font-medium px-4 py-2.5">№ на вписване</th>
                <th className="text-right font-medium px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-text">{p.name}</div>
                    {p.action && <div className="text-[11px] text-text-3 max-w-[420px] truncate">{p.action}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-text-2">
                    {p.product_type === "sport" ? "Спортна храна" : "Хранителна добавка"}
                  </td>
                  <td className="px-4 py-2.5 text-text-2">{p.reg_number || "—"}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Link
                      href={`/notify/product?id=${p.id}`}
                      className="inline-flex items-center gap-1.5 text-[12px] text-accent hover:underline"
                    >
                      <FileText size={14} /> Отвори / документи
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
