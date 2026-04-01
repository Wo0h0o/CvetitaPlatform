import { ReactNode } from "react";

export function PageHeader({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
      <h1 className="text-[22px] font-bold tracking-tight text-text">
        {title}
      </h1>
      {children && (
        <div className="flex items-center gap-2">{children}</div>
      )}
    </div>
  );
}
