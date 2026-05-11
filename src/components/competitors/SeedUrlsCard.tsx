"use client";

import { useState } from "react";
import { mutate } from "swr";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { useToast } from "@/providers/ToastProvider";
import { Loader2, Save, Target } from "lucide-react";

interface SeedUrlsCardProps {
  competitorSlug: string;
  initialSeedUrls: string[];
}

/**
 * Admin-curated category / collection URLs the scanner should harvest product
 * links from. Massive precision win for big sites like Gymbeam where sitemap
 * order is alphabetical and the first 30 entries are accessories instead of
 * supplements. One URL per line.
 */
export function SeedUrlsCard({ competitorSlug, initialSeedUrls }: SeedUrlsCardProps) {
  const { toast } = useToast();
  const [value, setValue] = useState(initialSeedUrls.join("\n"));
  const [saving, setSaving] = useState(false);

  const dirty = value.trim() !== initialSeedUrls.join("\n").trim();

  const handleSave = async () => {
    setSaving(true);
    try {
      const urls = value
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await fetch(`/api/competitors/${competitorSlug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seedUrls: urls }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Грешка");

      const saved: string[] = json.seedUrls || [];
      setValue(saved.join("\n"));
      toast(`Запазени ${saved.length} URL-а`, "success");
      mutate(`/api/competitors/${competitorSlug}`);
    } catch (err) {
      toast(`Грешка: ${err instanceof Error ? err.message : "Save failed"}`, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Target size={14} className="text-text-3" />
          <span>Целеви страници за сканиране</span>
        </div>
      </CardHeader>
      <CardBody>
        <p className="text-[12px] text-text-3 mb-3 leading-relaxed">
          По една категорийна / колекционна страница на ред. Ако са попълнени, scanner-ът извлича
          продуктови линкове само оттук, вместо да обхожда целия sitemap. Препоръчва се за големи
          магазини с много нерелевантни SKU.
          <br />
          Примери: <code className="text-text-2">https://vemoherb.com/product-category/active-sport/</code>,{" "}
          <code className="text-text-2">https://gymbeam.bg/aminokiseliny/</code>
        </p>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="https://example.com/category/supplements&#10;https://example.com/collections/vitamins"
          rows={4}
          className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2.5 text-[13px] text-text outline-none focus:border-accent placeholder:text-text-3 font-mono resize-y min-h-[88px]"
        />
        <div className="flex items-center justify-between mt-3">
          <span className="text-[11px] text-text-3">
            {dirty ? "Незапазени промени" : `${initialSeedUrls.length} URL-а запазени`}
          </span>
          <Button onClick={handleSave} disabled={!dirty || saving} size="sm">
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Запази
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
