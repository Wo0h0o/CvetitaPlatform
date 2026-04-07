"use client";

import { ReactNode, createContext, useContext, useState } from "react";

// ---------- Context ----------

interface TabsContextValue {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const TabsContext = createContext<TabsContextValue>({
  activeTab: "",
  setActiveTab: () => {},
});

// ---------- Tabs ----------

interface TabsProps {
  defaultTab: string;
  children: ReactNode;
  className?: string;
}

export function Tabs({ defaultTab, children, className = "" }: TabsProps) {
  const [activeTab, setActiveTab] = useState(defaultTab);
  return (
    <TabsContext.Provider value={{ activeTab, setActiveTab }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

// ---------- TabList ----------

export function TabList({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center gap-1 border-b border-border mb-4 ${className}`}
    >
      {children}
    </div>
  );
}

// ---------- Tab ----------

export function Tab({
  value,
  children,
}: {
  value: string;
  children: ReactNode;
}) {
  const { activeTab, setActiveTab } = useContext(TabsContext);
  const isActive = activeTab === value;

  return (
    <button
      onClick={() => setActiveTab(value)}
      className={`
        px-4 py-2.5 text-[13px] font-medium transition-colors relative
        ${
          isActive
            ? "text-text"
            : "text-text-3 hover:text-text-2"
        }
      `}
    >
      {children}
      {isActive && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-full" />
      )}
    </button>
  );
}

// ---------- TabPanel ----------

export function TabPanel({
  value,
  children,
}: {
  value: string;
  children: ReactNode;
}) {
  const { activeTab } = useContext(TabsContext);
  if (activeTab !== value) return null;
  return <>{children}</>;
}
