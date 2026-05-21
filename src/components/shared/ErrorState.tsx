import { AlertTriangle } from "lucide-react";
import type { ApiError } from "@/lib/swr";

/**
 * ErrorState — the third of the three states every data card must
 * design (CLAUDE.md principle 8: loading / error / empty).
 *
 * Renders INSIDE a CardBody — it is not a Card itself, because the
 * chart components already own their <Card><CardHeader>…</CardHeader>
 * shell and only the body swaps to this on failure. That keeps the
 * card title + period context visible so the operator knows WHICH
 * card broke, not just THAT something broke.
 *
 * Visual vocabulary: red is reserved by the design contract (§1) for
 * "bad / negative" — a failed fetch qualifies. We use it sparingly:
 * a small icon, a one-line message, an optional retry. No full-bleed
 * red panel; a broken card should read as "this one tile is down",
 * not "the dashboard is on fire".
 *
 * Usage:
 *   const { data, error, isLoading } = useAnalyticsSWR<T>(key);
 *   if (error) return (
 *     <Card>
 *       <CardHeader>Тренд на приходите</CardHeader>
 *       <CardBody><ErrorState error={error} onRetry={() => mutate()} /></CardBody>
 *     </Card>
 *   );
 */
export function ErrorState({
  error,
  onRetry,
  /** Tightens the vertical padding for short cards (signal tiles,
   *  small breakdown panels). Full charts use the default. */
  compact = false,
}: {
  error?: ApiError | Error | null;
  onRetry?: () => void;
  compact?: boolean;
}) {
  // Server-supplied message when we have one (ApiError carries the
  // API route's `{ error }` string); otherwise a generic line. We do
  // NOT dump raw stack traces at the operator — the status code is
  // the only technical detail worth surfacing.
  const status =
    error && "status" in error && typeof error.status === "number"
      ? error.status
      : null;

  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${
        compact ? "py-6" : "py-12"
      }`}
    >
      <div className="w-11 h-11 rounded-xl bg-red-soft flex items-center justify-center mb-3">
        <AlertTriangle size={20} className="text-red" />
      </div>
      <p className="text-[13px] font-medium text-text mb-1">
        Данните не се заредиха
      </p>
      <p className="text-[12px] text-text-3 max-w-[280px]">
        {status
          ? `Сървърът върна грешка ${status}. Опитай отново след малко.`
          : "Възникна проблем при свързване. Провери връзката и опитай пак."}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="
            mt-3 px-3 py-1.5 rounded-lg
            text-[12px] font-medium
            bg-surface-2 text-text-2
            hover:text-text hover:bg-border/40
            transition-colors cursor-pointer
          "
        >
          Опитай отново
        </button>
      )}
    </div>
  );
}
