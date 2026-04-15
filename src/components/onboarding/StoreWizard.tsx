"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { MarketFlag } from "@/components/shared/MarketFlag";
import { ConnectionTest } from "@/components/onboarding/ConnectionTest";
import { SyncProgress } from "@/components/onboarding/SyncProgress";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Store,
  Key,
  Rocket,
  Loader2,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StoreForm {
  name: string;
  marketCode: string;
  domain: string;
  accessToken: string;
  clientSecret: string;
}

type Step = 0 | 1 | 2 | 3; // 0=basics, 1=credentials, 2=review, 3=sync

const STEPS = [
  { label: "Основни данни", icon: Store },
  { label: "Credentials", icon: Key },
  { label: "Преглед", icon: Check },
  { label: "Синхронизация", icon: Rocket },
];

const MARKETS = [
  { code: "bg", label: "България" },
  { code: "gr", label: "Гърция" },
  { code: "ro", label: "Румъния" },
  { code: "hu", label: "Унгария" },
  { code: "hr", label: "Хърватия" },
  { code: "rs", label: "Сърбия" },
];

const inputClasses =
  "w-full bg-surface-2 border border-border rounded-lg px-3 py-2.5 text-[14px] text-text outline-none focus:border-accent transition-colors placeholder:text-text-3";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StoreWizard({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(0);
  const [form, setForm] = useState<StoreForm>({
    name: "",
    marketCode: "",
    domain: "",
    accessToken: "",
    clientSecret: "",
  });
  const [connectionOk, setConnectionOk] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdStoreId, setCreatedStoreId] = useState<string | null>(null);

  function updateField(field: keyof StoreForm, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (field === "domain" || field === "accessToken") {
      setConnectionOk(false);
    }
  }

  function canAdvance(): boolean {
    switch (step) {
      case 0:
        return !!form.name.trim() && !!form.marketCode && !!form.domain.trim();
      case 1:
        return !!form.accessToken.trim() && connectionOk;
      case 2:
        return true;
      default:
        return false;
    }
  }

  async function handleCreate() {
    setCreating(true);
    setCreateError(null);

    try {
      const res = await fetch("/api/stores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          marketCode: form.marketCode,
          platform: "shopify",
          domain: form.domain.trim(),
          accessToken: form.accessToken.trim(),
          clientSecret: form.clientSecret.trim() || undefined,
          organizationId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setCreateError(data.error || "Грешка при създаване");
        return;
      }

      setCreatedStoreId(data.storeId);
      setStep(3);
    } catch {
      setCreateError("Мрежова грешка");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Step indicator */}
      <div className="flex items-center justify-between mb-8">
        {STEPS.map((s, i) => {
          const active = i === step;
          const done = i < step;
          const Icon = s.icon;
          return (
            <div key={s.label} className="flex items-center gap-2 flex-1">
              <div
                className={`
                  flex items-center justify-center w-8 h-8 rounded-full text-[12px] font-semibold transition-colors
                  ${done ? "bg-accent text-white" : active ? "bg-accent/20 text-accent border border-accent" : "bg-surface-2 text-text-3"}
                `}
              >
                {done ? <Check size={14} /> : <Icon size={14} />}
              </div>
              <span
                className={`text-[12px] hidden sm:inline ${
                  active ? "text-text font-medium" : "text-text-3"
                }`}
              >
                {s.label}
              </span>
              {i < STEPS.length - 1 && (
                <div
                  className={`flex-1 h-px mx-2 ${
                    done ? "bg-accent" : "bg-border"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Step content */}
      <Card>
        <CardBody className="space-y-5">
          {/* STEP 0: Basics */}
          {step === 0 && (
            <>
              <h2 className="text-[16px] font-semibold text-text">
                Основна информация
              </h2>
              <div>
                <label className="block text-[13px] font-semibold text-text mb-1.5">
                  Име на магазина
                </label>
                <input
                  type="text"
                  className={inputClasses}
                  placeholder="Cvetita GR"
                  value={form.name}
                  onChange={(e) => updateField("name", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-text mb-1.5">
                  Пазар
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {MARKETS.map((m) => (
                    <button
                      key={m.code}
                      onClick={() => updateField("marketCode", m.code)}
                      className={`
                        px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all cursor-pointer
                        ${
                          form.marketCode === m.code
                            ? "bg-accent text-white shadow-sm"
                            : "bg-surface-2 text-text-2 hover:bg-surface-2/80"
                        }
                      `}
                    >
                      {m.code.toUpperCase()} — {m.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-text mb-1.5">
                  Shopify домейн
                </label>
                <input
                  type="text"
                  className={inputClasses}
                  placeholder="cvetita-gr.myshopify.com"
                  value={form.domain}
                  onChange={(e) => updateField("domain", e.target.value)}
                />
                <p className="text-[11px] text-text-3 mt-1">
                  Формат: your-store.myshopify.com
                </p>
              </div>
            </>
          )}

          {/* STEP 1: Credentials */}
          {step === 1 && (
            <>
              <h2 className="text-[16px] font-semibold text-text">
                Shopify Credentials
              </h2>
              <div>
                <label className="block text-[13px] font-semibold text-text mb-1.5">
                  Access Token
                </label>
                <input
                  type="password"
                  className={inputClasses}
                  placeholder="shpat_..."
                  value={form.accessToken}
                  onChange={(e) => updateField("accessToken", e.target.value)}
                />
                <p className="text-[11px] text-text-3 mt-1">
                  Custom App → Admin API access token
                </p>
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-text mb-1.5">
                  Client Secret
                  <span className="text-text-3 font-normal ml-1">(по избор)</span>
                </label>
                <input
                  type="password"
                  className={inputClasses}
                  placeholder="По избор — за HMAC верификация на webhooks"
                  value={form.clientSecret}
                  onChange={(e) => updateField("clientSecret", e.target.value)}
                />
              </div>

              <ConnectionTest
                domain={form.domain}
                accessToken={form.accessToken}
                onResult={(r) => setConnectionOk(r.ok)}
              />
            </>
          )}

          {/* STEP 2: Review */}
          {step === 2 && (
            <>
              <h2 className="text-[16px] font-semibold text-text">
                Преглед
              </h2>
              <div className="space-y-3 text-[13px]">
                <div className="flex justify-between">
                  <span className="text-text-2">Име</span>
                  <span className="font-medium text-text">{form.name}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-text-2">Пазар</span>
                  <MarketFlag market={form.marketCode} size={16} labelled />
                </div>
                <div className="flex justify-between">
                  <span className="text-text-2">Домейн</span>
                  <span className="text-text">{form.domain}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-2">Access Token</span>
                  <span className="text-text font-mono">
                    {form.accessToken.slice(0, 8)}...
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-2">Client Secret</span>
                  <span className="text-text">
                    {form.clientSecret ? "Да" : "Не"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-2">Schema</span>
                  <span className="font-mono text-text">
                    store_{form.marketCode}
                  </span>
                </div>
              </div>

              {createError && (
                <div className="bg-red-soft border border-red/20 rounded-lg p-3 text-[13px] text-red">
                  {createError}
                </div>
              )}
            </>
          )}

          {/* STEP 3: Sync */}
          {step === 3 && createdStoreId && (
            <>
              <h2 className="text-[16px] font-semibold text-text">
                Първоначална синхронизация
              </h2>
              <SyncProgress storeId={createdStoreId} />
            </>
          )}
        </CardBody>
      </Card>

      {/* Navigation buttons */}
      <div className="flex items-center justify-between mt-6">
        {step > 0 && step < 3 ? (
          <Button
            variant="ghost"
            onClick={() => setStep((s) => (s - 1) as Step)}
          >
            <ArrowLeft size={16} />
            Назад
          </Button>
        ) : (
          <div />
        )}

        {step < 2 && (
          <Button
            onClick={() => setStep((s) => (s + 1) as Step)}
            disabled={!canAdvance()}
          >
            Напред
            <ArrowRight size={16} />
          </Button>
        )}

        {step === 2 && (
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Създаване...
              </>
            ) : (
              <>
                <Rocket size={16} />
                Създай магазин
              </>
            )}
          </Button>
        )}

        {step === 3 && (
          <Button onClick={() => router.push("/settings/stores")}>
            Към магазини
            <ArrowRight size={16} />
          </Button>
        )}
      </div>
    </div>
  );
}
