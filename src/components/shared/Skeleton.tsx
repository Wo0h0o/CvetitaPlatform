export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-surface-2 ${className}`}
    />
  );
}

export function KpiSkeleton() {
  return (
    <div className="bg-surface rounded-xl shadow-sm p-5">
      <Skeleton className="h-3 w-20 mb-3" />
      <Skeleton className="h-8 w-28 mb-2" />
      <Skeleton className="h-5 w-16 rounded-full" />
    </div>
  );
}
