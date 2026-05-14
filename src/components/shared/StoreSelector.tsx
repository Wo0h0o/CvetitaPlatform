"use client";

import { useState, useRef, useEffect } from "react";
import useSWR from "swr";
import { ChevronDown, Store } from "lucide-react";
import { useStoreSelection } from "@/hooks/useStoreSelection";
import { MarketFlag } from "@/components/shared/MarketFlag";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface StoreItem {
  id: string;
  name: string;
  market_code: string;
}

export function StoreSelector() {
  const { selectedStore, setStore, isAll } = useStoreSelection();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data } = useSWR<{ stores: StoreItem[] }>(
    "/api/stores",
    fetcher,
    { revalidateOnFocus: false }
  );

  const stores = data?.stores ?? [];

  // Click outside to close
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [open]);

  // Keyboard: Escape closes
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) {
      document.addEventListener("keydown", handleKey);
      return () => document.removeEventListener("keydown", handleKey);
    }
  }, [open]);

  const selectedName = isAll
    ? "Всички магазини"
    : stores.find((s) => s.id === selectedStore)?.name ?? "Магазин";

  const selectedCode = isAll
    ? null
    : stores.find((s) => s.id === selectedStore)?.market_code ?? null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-2 border border-border hover:border-border-strong transition-colors text-[13px] text-text cursor-pointer"
      >
        {selectedCode ? (
          <MarketFlag market={selectedCode} size={14} labelled />
        ) : (
          <Store size={14} className="text-text-2" />
        )}
        <span className="font-medium">{selectedName}</span>
        <ChevronDown
          size={14}
          className={`text-text-3 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-surface rounded-xl shadow-lg border border-border z-50 py-1 animate-in fade-in slide-in-from-top-1 duration-150">
          {/* All stores option */}
          <button
            onClick={() => { setStore("all"); setOpen(false); }}
            className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-[13px] transition-colors cursor-pointer ${
              isAll
                ? "bg-accent-soft text-accent font-medium"
                : "text-text hover:bg-surface-2"
            }`}
          >
            <Store size={14} />
            <span>Всички магазини</span>
          </button>

          {stores.length > 0 && (
            <div className="border-t border-border my-1" />
          )}

          {stores.map((store) => {
            const active = selectedStore === store.id;
            return (
              <button
                key={store.id}
                onClick={() => { setStore(store.id); setOpen(false); }}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-[13px] transition-colors cursor-pointer ${
                  active
                    ? "bg-accent-soft text-accent font-medium"
                    : "text-text hover:bg-surface-2"
                }`}
              >
                <MarketFlag market={store.market_code} size={14} labelled />
                <span>{store.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
