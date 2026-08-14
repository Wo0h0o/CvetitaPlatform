"use client";

import useSWR from "swr";
import { Boxes, Loader2, AlertTriangle } from "lucide-react";
import { Card } from "@/components/shared/Card";
import { PageHeader } from "@/components/shared/PageHeader";
import { ProductionSelector, Row } from "@/components/production/ProductionSelector";

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const fmtDate = (s: string) => (s ? s.split("-").reverse().join(".") : "—");

interface Snapshot {
  ishleme?: Row[];
}

export default function IshlemePage() {
  const { data, isLoading } = useSWR<{ snapshot: Snapshot | null; as_of?: string }>(
    "/api/production/forecast",
    fetcher,
    { revalidateOnFocus: false }
  );
  const snap = data?.snapshot ?? null;
  const rows = snap?.ishleme ?? [];

  return (
    <div className="pb-24">
      <PageHeader
        title={
          <>
            <Boxes size={22} className="text-accent" /> Наличности — Ишлемета
          </>
        }
      >
        {data?.as_of && <span className="text-[13px] text-text-3">към {fmtDate(data.as_of)}</span>}
      </PageHeader>

      {isLoading && (
        <div className="flex items-center gap-2 text-text-3 py-12 justify-center">
          <Loader2 className="animate-spin" size={18} /> Зареждане…
        </div>
      )}

      {!isLoading && !snap && (
        <Card className="p-6 flex items-start gap-3">
          <AlertTriangle className="text-amber-500 flex-shrink-0" size={20} />
          <div className="text-[14px] text-text-2">Още няма качена прогноза от PRIM.</div>
        </Card>
      )}

      {!isLoading && snap && (
        <>
          <p className="text-[13px] text-text-3 mb-4">
            Продукти произвеждани по договор (ИШЛЕМЕТА). Избери и пусни възлагателно писмо — рецептата и суровините се показват в писмото както при собствените продукти.
          </p>
          <ProductionSelector rows={rows} listTitle="Ишлеме продукти" showBuckets={false} />
        </>
      )}
    </div>
  );
}
