"use client";

import React, { useState } from "react";
import Image from "next/image";

export default function StudioLogo() {
  const [themeMode, setThemeMode] = useState<"dark" | "light">("dark");

  const toggleTheme = () => {
    setThemeMode((prev) => (prev === "dark" ? "light" : "dark"));
  };

  return (
    <aside
      aria-label="BU Studio"
      className="hidden md:block fixed bottom-5 right-5 sm:bottom-7 sm:right-7 z-40 select-none group"
    >
      <div className="relative flex flex-col items-center">
        {/* Glow Arkası (Görsel Derinlik) */}
        <div
          className={`absolute -inset-3 rounded-3xl blur-2xl transition-all duration-500 pointer-events-none ${
            themeMode === "dark"
              ? "bg-gradient-to-tr from-emerald-500/25 via-indigo-500/20 to-teal-400/20 opacity-60 group-hover:opacity-100 group-hover:scale-105"
              : "bg-white/20 opacity-50 group-hover:opacity-80"
          }`}
        />

        {/* Logo Kartı */}
        <div
          onClick={toggleTheme}
          title="BU Studio — Tıklayarak koyu/açık logo temasını değiştirebilirsiniz"
          className={`relative cursor-pointer overflow-hidden rounded-2xl border p-4 sm:p-5 backdrop-blur-2xl shadow-2xl transition-all duration-300 hover:scale-[1.03] active:scale-[0.98] ${
            themeMode === "dark"
              ? "border-zinc-800/80 bg-zinc-950/75 hover:border-emerald-500/50 shadow-black/80 hover:shadow-emerald-500/10"
              : "border-zinc-200 bg-white hover:border-zinc-400 shadow-2xl shadow-black/30"
          }`}
        >
          {/* İnce Yansıma Efekti */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.06] to-transparent" />

          {/* Logo Görseli — Büyük ve Net */}
          <div className="relative w-44 h-44 sm:w-56 sm:h-56 md:w-64 md:h-64 flex items-center justify-center">
            <Image
              src={
                themeMode === "dark"
                  ? "/studio-logo.png"
                  : "/studio-logo-original.png"
              }
              alt="BU Studio Logo"
              width={260}
              height={260}
              priority
              className={`w-full h-full object-contain transition-transform duration-300 group-hover:scale-105 ${
                themeMode === "dark"
                  ? "filter drop-shadow-[0_4px_20px_rgba(255,255,255,0.18)]"
                  : "filter drop-shadow-[0_4px_12px_rgba(0,0,0,0.15)]"
              }`}
            />
          </div>

          {/* Alt Marka Etiketi & Tema Değiştirme İpucu */}
          <div className="mt-2 flex items-center justify-between gap-2 px-1 text-[11px] font-mono tracking-widest uppercase">
            <div className="flex items-center gap-1.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  themeMode === "dark"
                    ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse"
                    : "bg-zinc-800"
                }`}
              />
              <span
                className={`font-semibold tracking-wider ${
                  themeMode === "dark"
                    ? "text-zinc-300 group-hover:text-emerald-300"
                    : "text-zinc-800"
                }`}
              >
                BU STUDIO
              </span>
            </div>
            <span
              className={`text-[9px] lowercase tracking-normal px-1.5 py-0.5 rounded ${
                themeMode === "dark"
                  ? "bg-zinc-900 text-zinc-500 border border-zinc-800/80"
                  : "bg-zinc-100 text-zinc-600 border border-zinc-200"
              }`}
            >
              {themeMode === "dark" ? "koyu" : "açık"}
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
