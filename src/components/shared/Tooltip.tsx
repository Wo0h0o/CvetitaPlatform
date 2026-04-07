import { ReactNode } from "react";

interface TooltipProps {
  content: string;
  children: ReactNode;
  position?: "top" | "bottom";
}

export function Tooltip({ content, children, position = "top" }: TooltipProps) {
  const posClass =
    position === "top"
      ? "bottom-full left-1/2 -translate-x-1/2 mb-1.5"
      : "top-full left-1/2 -translate-x-1/2 mt-1.5";

  return (
    <span className="relative group inline-flex">
      {children}
      <span
        className={`
          absolute ${posClass} hidden group-hover:block
          bg-text text-surface text-[10px] px-2 py-1 rounded
          whitespace-nowrap z-50 pointer-events-none
        `}
      >
        {content}
      </span>
    </span>
  );
}
