"use client";

import { useState, useEffect, ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function Shell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const saved = localStorage.getItem("sidebar-collapsed");
    if (saved === "true") setCollapsed(true);

    const savedDark = localStorage.getItem("dark-mode");
    if (savedDark === "true") {
      setDarkMode(true);
      document.documentElement.classList.add("dark");
    }
  }, []);

  // Close mobile drawer on navigation
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("sidebar-collapsed", String(next));
  };

  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    localStorage.setItem("dark-mode", String(next));
    document.documentElement.classList.toggle("dark", next);
  };

  return (
    <>
      <Sidebar
        collapsed={collapsed}
        onToggle={toggleCollapsed}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />
      <TopBar
        sidebarCollapsed={collapsed}
        darkMode={darkMode}
        onToggleDarkMode={toggleDarkMode}
        onBurgerClick={() => setMobileOpen(!mobileOpen)}
      />
      <main
        className={`
          pt-[var(--topbar-height)] min-h-screen
          transition-all duration-300 ease-out
          pl-0 ${collapsed ? "md:pl-[72px]" : "md:pl-[var(--sidebar-width)]"}
        `}
      >
        <div className="p-4 md:p-6 max-w-[1400px]">{children}</div>
      </main>
    </>
  );
}
