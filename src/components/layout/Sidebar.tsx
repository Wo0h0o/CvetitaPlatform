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
  ShoppingBag,
  BarChart3,
  Mail,
  Megaphone,
} from "lucide-react";

interface NavChild {
  href: string;
  label: string;
}

interface NavItem {
  href: string;
  icon: typeof LayoutDashboard;
  label: string;
  children?: NavChild[];
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    label: "Основни",
    items: [
      { href: "/", icon: LayoutDashboard, label: "Дашборд" },
      { href: "/analysis", icon: Search, label: "AI Анализ" },
    ],
  },
  {
    label: "Отчети",
    items: [
      { href: "/products", icon: ShoppingBag, label: "Продукти" },
      { href: "/traffic", icon: BarChart3, label: "Трафик & SEO" },
      { href: "/email", icon: Mail, label: "Имейли" },
      {
        href: "/ads",
        icon: Megaphone,
        label: "Реклама",
        children: [
          { href: "/ads", label: "Реклами" },
          { href: "/ads/campaigns", label: "Кампании" },
        ],
      },
    ],
  },
  {
    label: "Система",
    items: [
      { href: "/agents", icon: Sparkles, label: "Агенти" },
      { href: "/settings", icon: Settings, label: "Настройки" },
    ],
  },
];

export function Sidebar({
  collapsed,
  onToggle,
  mobileOpen,
  onMobileClose,
}: {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={`sidebar-backdrop md:hidden ${mobileOpen ? "open" : ""}`}
        onClick={onMobileClose}
      />

      <aside
        className={`
          fixed top-0 left-0 h-full z-40
          bg-surface border-r border-border
          flex flex-col
          transition-all duration-300 ease-out
          w-[var(--sidebar-width)]
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"}
          md:translate-x-0
          ${collapsed ? "md:w-[72px]" : "md:w-[var(--sidebar-width)]"}
        `}
      >
        {/* Logo */}
        <div className="flex items-center h-[var(--topbar-height)] px-5 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center flex-shrink-0">
              <div className="w-3 h-3 rounded-full bg-white" />
            </div>
            <div className={`whitespace-nowrap ${collapsed ? "md:hidden" : ""}`}>
              <div className="text-[15px] font-semibold text-text leading-tight">
                Цветита
              </div>
              <div className="text-[11px] text-text-3 leading-tight">
                Команден Център
              </div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-3">
          {navSections.map((section) => (
            <div key={section.label} className="mb-6">
              <div className={`px-3 mb-2 text-[11px] font-medium uppercase tracking-wider text-text-3 ${collapsed ? "md:hidden" : ""}`}>
                {section.label}
              </div>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive = item.children
                    ? pathname.startsWith(item.href)
                    : pathname === item.href;
                  const showChildren = item.children && isActive && !collapsed;
                  return (
                    <div key={item.href + item.label}>
                      <Link
                        href={item.href}
                        onClick={onMobileClose}
                        className={`
                          flex items-center gap-3 rounded-lg transition-all duration-150
                          px-3 py-3 md:py-2.5
                          ${collapsed ? "md:justify-center md:px-2" : ""}
                          ${
                            isActive
                              ? "bg-accent-soft text-accent font-medium border-l-2 border-accent"
                              : "text-text-2 hover:text-text hover:bg-surface-2"
                          }
                        `}
                        title={collapsed ? item.label : undefined}
                      >
                        <item.icon size={20} strokeWidth={isActive ? 2 : 1.5} />
                        <span className={`text-[14px] ${collapsed ? "md:hidden" : ""}`}>
                          {item.label}
                        </span>
                      </Link>
                      {showChildren && (
                        <div className="ml-6 mt-0.5 space-y-0.5">
                          {item.children!.map((child) => {
                            const childActive = pathname === child.href;
                            return (
                              <Link
                                key={child.href}
                                href={child.href}
                                onClick={onMobileClose}
                                className={`
                                  block px-3 py-1.5 rounded-lg text-[12px] transition-colors
                                  ${childActive
                                    ? "text-accent font-medium"
                                    : "text-text-3 hover:text-text hover:bg-surface-2"
                                  }
                                `}
                              >
                                {child.label}
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Collapse toggle - desktop only */}
        <div className="hidden md:block border-t border-border p-3">
          <button
            onClick={onToggle}
            className="flex items-center justify-center w-full py-2 rounded-lg text-text-3 hover:text-text hover:bg-surface-2 transition-colors cursor-pointer"
          >
            {collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>
      </aside>
    </>
  );
}
