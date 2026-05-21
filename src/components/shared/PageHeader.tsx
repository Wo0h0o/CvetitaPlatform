import { ReactNode } from "react";

export function PageHeader({
  title,
  children,
}: {
  /** Page title. Accepts ReactNode so pages can inline icons (e.g. a
   * MarketFlag) alongside the heading text. */
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
      <h1 className="text-[22px] font-bold tracking-tight text-text flex items-center gap-2">
        {title}
      </h1>
      {children && (
        // flex-wrap on mobile so the StoreSelector + DateRangePicker
        // pair don't push the page past viewport width when both are
        // present. min-w-0 lets shrink succeed when the picker is
        // still narrow enough to share a row with the title on sm+.
        <div className="flex items-center flex-wrap gap-2 min-w-0">
          {children}
        </div>
      )}
    </div>
  );
}
