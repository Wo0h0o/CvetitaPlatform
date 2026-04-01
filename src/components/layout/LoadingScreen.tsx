"use client";

import { useEffect, useState } from "react";

const STEPS = [
  "Зареждам продажби от Shopify...",
  "Анализирам продуктови данни...",
  "Извличам данни от Google Analytics...",
  "Синхронизирам имейл метрики...",
  "Подготвям дашборда...",
];

export function LoadingScreen({ progress }: { progress: number }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [dots, setDots] = useState("");

  useEffect(() => {
    const idx = Math.min(
      Math.floor((progress / 100) * STEPS.length),
      STEPS.length - 1
    );
    setStepIndex(idx);
  }, [progress]);

  // Animated dots
  useEffect(() => {
    const timer = setInterval(() => {
      setDots((d) => (d.length >= 3 ? "" : d + "."));
    }, 400);
    return () => clearInterval(timer);
  }, []);

  return (
    <div
      className={`
        fixed inset-0 z-[200] bg-surface flex flex-col items-center justify-center
        transition-opacity duration-700 ease-out
        ${progress >= 100 ? "opacity-0 pointer-events-none" : "opacity-100"}
      `}
    >
      {/* Logo mark */}
      <div className="mb-10 flex flex-col items-center">
        <div className="w-14 h-14 rounded-2xl bg-accent flex items-center justify-center mb-5 shadow-lg">
          <svg
            viewBox="0 0 32 32"
            fill="none"
            className="w-8 h-8"
            xmlns="http://www.w3.org/2000/svg"
          >
            {/* Simple leaf / plant icon */}
            <path
              d="M16 4C16 4 6 10 6 19C6 24.52 10.48 29 16 29C21.52 29 26 24.52 26 19C26 10 16 4 16 4Z"
              fill="white"
              fillOpacity="0.9"
            />
            <path
              d="M16 29V16"
              stroke="white"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path
              d="M16 21C16 21 11 17 9 13"
              stroke="white"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeOpacity="0.6"
            />
          </svg>
        </div>

        <h1 className="text-[26px] font-bold tracking-tight text-text">
          Цветита <span className="text-accent">Хербал</span>
        </h1>
        <p className="text-[13px] text-text-3 mt-1 tracking-wide">
          КОМАНДЕН ЦЕНТЪР
        </p>
      </div>

      {/* Progress bar */}
      <div className="w-56 mb-4">
        <div className="h-[3px] bg-border rounded-full overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Status text */}
      <p className="text-[12px] text-text-3 h-4">
        {STEPS[stepIndex]}
        <span className="inline-block w-5 text-left">{dots}</span>
      </p>

      {/* Percentage */}
      <p className="text-[11px] text-text-3/50 mt-3 tabular-nums">
        {Math.min(progress, 99)}%
      </p>
    </div>
  );
}
