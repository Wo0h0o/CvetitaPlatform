"use client";

import { usePathname } from "next/navigation";
import { Sun, Moon } from "lucide-react";
import { DateRangePicker } from "@/components/shared/DateRangePicker";

const pageTitles: Record<string, string> = {
  "/": "Дашборд",
  "/analysis": "AI Анализ",
  "/products": "Продуктов Анализ",
  "/traffic": "Трафик & SEO",
  "/email": "Имейл Маркетинг",
  "/ads": "Рекламен Отчет",
  "/agents": "Агенти",
  "/settings": "Настройки",
};

// Pages where date range filter is relevant
const dateFilterPages = ["/", "/products", "/traffic", "/email"];

export function TopBar({
  sidebarCollapsed,
  darkMode,
  onToggleDarkMode,
}: {
  sidebarCollapsed: boolean;
  darkMode: boolean;
  onToggleDarkMode: () => void;
}) {
  const pathname = usePathname();
  const title = pageTitles[pathname] || "";
  const showDateFilter = dateFilterPages.includes(pathname);

  return (
    <header
      className={`
        fixed top-0 right-0 z-30
        h-[var(--topbar-height)] bg-surface/80 backdrop-blur-xl
        border-b border-border
        flex items-center justify-between px-6
        transition-all duration-300 ease-out
        ${sidebarCollapsed ? "left-[72px]" : "left-[var(--sidebar-width)]"}
      `}
    >
      <div className="flex-shrink-0">
        <h1 className="text-[17px] font-semibold text-text">{title}</h1>
      </div>

      {/* Date Range Picker - center */}
      {showDateFilter && (
        <div className="hidden md:flex">
          <DateRangePicker />
        </div>
      )}

      <div className="flex items-center gap-4 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          <span className="text-[12px] text-text-3">Live</span>
        </div>

        <button
          onClick={onToggleDarkMode}
          className="p-2 rounded-lg text-text-3 hover:text-text hover:bg-surface-2 transition-colors cursor-pointer"
        >
          {darkMode ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </header>
  );
}
