"use client";

import { useEffect, useCallback, ReactNode } from "react";
import { X } from "lucide-react";

// ---------- Modal ----------

interface ModalProps {
  open: boolean;
  onClose: () => void;
  size?: "sm" | "md" | "lg" | "full";
  children: ReactNode;
}

const sizeClasses: Record<string, string> = {
  sm: "md:max-w-sm",
  md: "md:max-w-lg",
  lg: "md:max-w-2xl",
  full: "md:max-w-4xl",
};

export function Modal({ open, onClose, size = "md", children }: ModalProps) {
  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [open, handleKey]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Panel */}
      <div
        className={`
          relative w-full h-full md:h-auto md:max-h-[90vh]
          md:rounded-2xl bg-surface shadow-2xl overflow-y-auto
          ${sizeClasses[size]}
        `}
      >
        {children}
      </div>
    </div>
  );
}

// ---------- ModalHeader ----------

export function ModalHeader({
  children,
  onClose,
  subtitle,
}: {
  children: ReactNode;
  onClose?: () => void;
  subtitle?: string;
}) {
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-border bg-surface/95 backdrop-blur-sm">
      <div className="min-w-0 flex-1 mr-3">
        <div className="text-[15px] font-semibold text-text truncate">{children}</div>
        {subtitle && (
          <div className="text-[12px] text-text-2 truncate">{subtitle}</div>
        )}
      </div>
      {onClose && (
        <button
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-surface-2 transition-colors flex-shrink-0"
        >
          <X size={18} className="text-text-3" />
        </button>
      )}
    </div>
  );
}

// ---------- ModalBody ----------

export function ModalBody({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`p-5 ${className}`}>{children}</div>;
}

// ---------- ModalFooter ----------

export function ModalFooter({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 p-4 border-t border-border bg-surface/95 backdrop-blur-sm">
      {children}
    </div>
  );
}
