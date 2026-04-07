"use client";

import { useState, useMemo, type ReactNode } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Column<T> {
  key: string;
  label: string;
  /** Render cell content. Falls back to row[key] */
  render?: (row: T) => ReactNode;
  /** Sort comparator. Return number (a-b). If omitted, column is not sortable */
  sortFn?: (a: T, b: T) => number;
  /** Tailwind classes for the <th>/<td> (e.g. "text-right", "w-32") */
  className?: string;
  /** Hide this column on mobile — shown only in desktop table */
  hideOnMobile?: boolean;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  /** Unique key extractor per row */
  rowKey: (row: T) => string;
  /** Rows per page. 0 = no pagination (show all) */
  pageSize?: number;
  /** Render a mobile card for each row (below md breakpoint) */
  renderMobileCard?: (row: T) => ReactNode;
  /** Click handler for the whole row */
  onRowClick?: (row: T) => void;
  /** Empty state message */
  emptyMessage?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DataTable<T>({
  columns,
  data,
  rowKey,
  pageSize = 10,
  renderMobileCard,
  onRowClick,
  emptyMessage = "Няма данни",
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);

  // Sort
  const sorted = useMemo(() => {
    if (!sortKey) return data;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortFn) return data;
    const copy = [...data];
    copy.sort((a, b) => (sortDir === "asc" ? col.sortFn!(a, b) : col.sortFn!(b, a)));
    return copy;
  }, [data, sortKey, sortDir, columns]);

  // Paginate
  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const safePage = Math.min(page, totalPages - 1);
  const paged = pageSize > 0 ? sorted.slice(safePage * pageSize, (safePage + 1) * pageSize) : sorted;

  // Reset page when data changes
  if (safePage !== page) setPage(safePage);

  function handleSort(key: string) {
    const col = columns.find((c) => c.key === key);
    if (!col?.sortFn) return;
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(0);
  }

  function renderCell(row: T, col: Column<T>) {
    if (col.render) return col.render(row);
    return String((row as Record<string, unknown>)[col.key] ?? "");
  }

  // ---- Empty ----
  if (data.length === 0) {
    return (
      <div className="text-center py-10 text-text-2 text-[13px]">
        {emptyMessage}
      </div>
    );
  }

  return (
    <>
      {/* ---- Mobile card list ---- */}
      {renderMobileCard && (
        <div className="md:hidden space-y-3">
          {paged.map((row) => (
            <div
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={onRowClick ? "cursor-pointer" : ""}
            >
              {renderMobileCard(row)}
            </div>
          ))}
        </div>
      )}

      {/* ---- Desktop table ---- */}
      <div className={`overflow-x-auto ${renderMobileCard ? "hidden md:block" : ""}`}>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border">
              {columns
                .filter((c) => !c.hideOnMobile || renderMobileCard === undefined)
                .map((col) => {
                  const sortable = !!col.sortFn;
                  const active = sortKey === col.key;
                  return (
                    <th
                      key={col.key}
                      onClick={sortable ? () => handleSort(col.key) : undefined}
                      className={`
                        px-3 py-2.5 text-left font-semibold text-text-2 whitespace-nowrap
                        ${sortable ? "cursor-pointer select-none hover:text-text transition-colors" : ""}
                        ${col.className ?? ""}
                      `}
                    >
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        {sortable && (
                          active ? (
                            sortDir === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                          ) : (
                            <ChevronsUpDown size={14} className="opacity-30" />
                          )
                        )}
                      </span>
                    </th>
                  );
                })}
            </tr>
          </thead>
          <tbody>
            {paged.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`
                  border-b border-border/50 last:border-b-0
                  ${onRowClick ? "cursor-pointer hover:bg-surface-2 transition-colors" : ""}
                `}
              >
                {columns
                  .filter((c) => !c.hideOnMobile || renderMobileCard === undefined)
                  .map((col) => (
                    <td key={col.key} className={`px-3 py-3 ${col.className ?? ""}`}>
                      {renderCell(row, col)}
                    </td>
                  ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---- Pagination ---- */}
      {pageSize > 0 && totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 text-[12px] text-text-2">
          <span>
            {safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, sorted.length)} от {sorted.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="p-1.5 rounded-lg hover:bg-surface-2 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="px-2">
              {safePage + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
              className="p-1.5 rounded-lg hover:bg-surface-2 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
