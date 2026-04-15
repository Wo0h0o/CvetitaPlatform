"use client";

import { Sun, Moon, Menu } from "lucide-react";
import { TopBarStoreSwitcher } from "./TopBarStoreSwitcher";

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
          aria-label="Отвори меню"
        >
          <Menu size={20} />
        </button>
      </div>

      {/*
        Center slot: store switcher. Renders null on routes where a market
        concept doesn't apply (home, settings, etc.), so the header collapses
        to its original burger + right-icons layout in those cases.
      */}
      <div className="flex-1 flex items-center justify-center px-3">
        <TopBarStoreSwitcher />
      </div>

      <div className="flex items-center gap-4 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          <span className="text-[12px] text-text-3">Live</span>
        </div>

        <button
          onClick={onToggleDarkMode}
          className="p-2.5 rounded-lg text-text-3 hover:text-text hover:bg-surface-2 transition-colors cursor-pointer"
          aria-label={darkMode ? "Превключи към светъл режим" : "Превключи към тъмен режим"}
        >
          {darkMode ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </header>
  );
}
