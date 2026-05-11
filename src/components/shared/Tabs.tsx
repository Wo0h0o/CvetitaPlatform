"use client";

import { ReactNode } from "react";

export interface TabDef<T extends string = string> {
  id: T;
  label: string;
  count?: number;
  icon?: ReactNode;
}

interface TabsProps<T extends string> {
  tabs: TabDef<T>[];
  active: T;
  onChange: (id: T) => void;
  className?: string;
}

export function Tabs<T extends string>({ tabs, active, onChange, className = "" }: TabsProps<T>) {
  return (
    <div className={`flex items-center gap-1 border-b border-border overflow-x-auto ${className}`}>
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`
              relative flex items-center gap-2 px-4 py-3 text-[13px] font-medium whitespace-nowrap
              transition-colors cursor-pointer
              ${isActive ? "text-text" : "text-text-3 hover:text-text-2"}
            `}
          >
            {tab.icon}
            <span>{tab.label}</span>
            {typeof tab.count === "number" && (
              <span
                className={`
                  inline-flex items-center justify-center min-w-[20px] h-[20px] px-1.5 rounded-full
                  text-[11px] font-semibold
                  ${isActive ? "bg-accent text-white" : "bg-surface-2 text-text-2"}
                `}
              >
                {tab.count}
              </span>
            )}
            {isActive && (
              <span className="absolute bottom-[-1px] left-2 right-2 h-[2px] bg-accent rounded-full" />
            )}
          </button>
        );
      })}
    </div>
  );
}
