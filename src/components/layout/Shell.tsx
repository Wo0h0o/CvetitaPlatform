"use client";

import { useState, useEffect, ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function Shell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("sidebar-collapsed");
    if (saved === "true") setCollapsed(true);

    const savedDark = localStorage.getItem("dark-mode");
    if (savedDark === "true") {
      setDarkMode(true);
      document.documentElement.classList.add("dark");
    }
  }, []);

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
      <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />
      <TopBar
        sidebarCollapsed={collapsed}
        darkMode={darkMode}
        onToggleDarkMode={toggleDarkMode}
      />
      <main
        className={`
          pt-[var(--topbar-height)] min-h-screen
          transition-all duration-300 ease-out
          ${collapsed ? "pl-[72px]" : "pl-[var(--sidebar-width)]"}
        `}
      >
        <div className="p-6 max-w-[1400px]">{children}</div>
      </main>
    </>
  );
}
