"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard,
  Search,
  Sparkles,
  Settings,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";

const navSections = [
  {
    label: "Основни",
    items: [
      { href: "/", icon: LayoutDashboard, label: "Дашборд" },
      { href: "/analysis", icon: Search, label: "Анализ" },
      { href: "/agents", icon: Sparkles, label: "Агенти" },
    ],
  },
  {
    label: "Система",
    items: [
      { href: "/settings", icon: Settings, label: "Настройки" },
    ],
  },
];

export function Sidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const pathname = usePathname();

  return (
    <aside
      className={`
        fixed top-0 left-0 h-full z-40
        bg-surface border-r border-border
        flex flex-col
        transition-all duration-300 ease-out
        ${collapsed ? "w-[72px]" : "w-[var(--sidebar-width)]"}
      `}
    >
      {/* Logo */}
      <div className="flex items-center h-[var(--topbar-height)] px-5 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center flex-shrink-0">
            <div className="w-3 h-3 rounded-full bg-white" />
          </div>
          {!collapsed && (
            <div className="whitespace-nowrap">
              <div className="text-[15px] font-semibold text-text leading-tight">
                Цветита
              </div>
              <div className="text-[11px] text-text-3 leading-tight">
                Команден Център
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-3">
        {navSections.map((section) => (
          <div key={section.label} className="mb-6">
            {!collapsed && (
              <div className="px-3 mb-2 text-[11px] font-medium uppercase tracking-wider text-text-3">
                {section.label}
              </div>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`
                      flex items-center gap-3 rounded-lg transition-all duration-150
                      ${collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2.5"}
                      ${
                        isActive
                          ? "bg-accent-soft text-accent font-medium border-l-2 border-accent"
                          : "text-text-2 hover:text-text hover:bg-surface-2"
                      }
                    `}
                    title={collapsed ? item.label : undefined}
                  >
                    <item.icon size={20} strokeWidth={isActive ? 2 : 1.5} />
                    {!collapsed && (
                      <span className="text-[14px]">{item.label}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Collapse toggle */}
      <div className="border-t border-border p-3">
        <button
          onClick={onToggle}
          className="flex items-center justify-center w-full py-2 rounded-lg text-text-3 hover:text-text hover:bg-surface-2 transition-colors cursor-pointer"
        >
          {collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>
    </aside>
  );
}
