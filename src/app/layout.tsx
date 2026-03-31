import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Цветита Хербал — Команден Център",
  description: "Вътрешна платформа за маркетинг анализи и автоматизация",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="bg" className={`${inter.variable} h-full`}>
      <body className="min-h-full font-[family-name:var(--font-inter)] antialiased">
        {children}
      </body>
    </html>
  );
}
