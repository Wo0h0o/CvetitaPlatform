"use client";

import { usePathname } from "next/navigation";
import { Sun, Moon } from "lucide-react";

const pageTitles: Record<string, string> = {
  "/": "Дашборд",
  "/analysis": "Пазарен Анализ",
  "/agents": "Агенти",
  "/settings": "Настройки",
};

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

  const today = new Date().toLocaleDateString("bg-BG", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

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
      <div>
        <h1 className="text-[17px] font-semibold text-text">{title}</h1>
      </div>

      <div className="flex items-center gap-4">
        <span className="text-[13px] text-text-3 capitalize">{today}</span>

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
