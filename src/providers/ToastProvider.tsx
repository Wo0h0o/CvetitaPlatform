"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { CheckCircle, AlertCircle, Info, X } from "lucide-react";

// ---------- Types ----------

type ToastType = "success" | "error" | "info";

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

// ---------- Provider ----------

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: ToastType = "success") => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Toast Stack */}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ---------- Toast Item ----------

const iconMap: Record<ToastType, typeof CheckCircle> = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
};

const styleMap: Record<ToastType, string> = {
  success: "border-accent/30 bg-accent-soft",
  error: "border-red/30 bg-red-soft",
  info: "border-blue/30 bg-blue-soft",
};

const iconColorMap: Record<ToastType, string> = {
  success: "text-accent",
  error: "text-red",
  info: "text-blue",
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const Icon = iconMap[toast.type];
  return (
    <div
      className={`
        pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border
        bg-surface shadow-lg backdrop-blur-sm min-w-[280px] max-w-[400px]
        animate-[slideUp_200ms_ease-out] ${styleMap[toast.type]}
      `}
    >
      <Icon size={18} className={iconColorMap[toast.type]} />
      <span className="flex-1 text-[13px] text-text">{toast.message}</span>
      <button
        onClick={onDismiss}
        className="p-1 rounded-md hover:bg-surface-2 transition-colors"
      >
        <X size={14} className="text-text-3" />
      </button>
    </div>
  );
}
