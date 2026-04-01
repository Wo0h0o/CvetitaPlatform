"use client";

import { Sun, Moon, Menu } from "lucide-react";

export function TopBar({
  sidebarCollapsed,
  darkMode,
  onToggleDarkMode,
  onBurgerClick,
}: {
  sidebarCollapsed: boolean;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onBurgerClick: () => void;
}) {
  return (
    <header
      className={`
        fixed top-0 right-0 z-30
        h-[var(--topbar-height)] bg-surface/80 backdrop-blur-xl
        border-b border-border
        flex items-center justify-between px-4 md:px-6
        transition-all duration-300 ease-out
        left-0 ${sidebarCollapsed ? "md:left-[72px]" : "md:left-[var(--sidebar-width)]"}
      `}
    >
      <div className="flex items-center gap-3 flex-shrink-0">
        <button
          onClick={onBurgerClick}
          className="md:hidden p-2.5 -ml-2 rounded-lg text-text-2 hover:text-text hover:bg-surface-2 transition-colors cursor-pointer"
          aria-label="Toggle menu"
        >
          <Menu size={20} />
        </button>
      </div>

      <div className="flex items-center gap-4 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          <span className="text-[12px] text-text-3">Live</span>
        </div>

        <button
          onClick={onToggleDarkMode}
          className="p-2.5 rounded-lg text-text-3 hover:text-text hover:bg-surface-2 transition-colors cursor-pointer"
        >
          {darkMode ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </header>
  );
}
