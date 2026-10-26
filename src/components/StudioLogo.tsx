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
      aria-label="VoxSub Studio"
      className="hidden md:block fixed bottom-4 right-4 z-40 select-none group"
    >
      <div className="relative flex flex-col items-center">
        {/* Glow Arkası (Görsel Derinlik) */}
        <div
          className={`absolute -inset-1.5 rounded-2xl blur-xl transition-all duration-500 pointer-events-none ${
            themeMode === "dark"
              ? "bg-gradient-to-tr from-emerald-500/25 via-teal-500/20 to-indigo-500/20 opacity-60 group-hover:opacity-95"
              : "bg-white/30 opacity-40 group-hover:opacity-75"
          }`}
        />

        {/* Kompakt Logo Kartı */}
        <div
          onClick={toggleTheme}
          title="VoxSub Studio — Tıklayarak koyu/açık logo temasını değiştirebilirsiniz"
          className={`relative cursor-pointer overflow-hidden rounded-xl border p-2.5 backdrop-blur-2xl shadow-xl transition-all duration-300 hover:scale-[1.03] active:scale-[0.98] ${
            themeMode === "dark"
              ? "border-zinc-800/80 bg-zinc-950/85 hover:border-emerald-500/50 shadow-black/80"
              : "border-zinc-200 bg-white/95 hover:border-zinc-400 shadow-black/25"
          }`}
        >
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.05] to-transparent" />

          {/* Logo Görseli */}
          <div className="relative w-32 h-14 flex items-center justify-center">
            <Image
              src={
                themeMode === "dark"
                  ? "/voxsub-logo.png"
                  : "/voxsub-logo-light.png"
              }
              alt="VoxSub Studio Logo"
              width={128}
              height={56}
              priority
              className={`w-full h-full object-contain transition-transform duration-300 group-hover:scale-105 ${
                themeMode === "dark"
                  ? "filter drop-shadow-[0_2px_10px_rgba(52,211,153,0.3)]"
                  : "filter drop-shadow-[0_2px_6px_rgba(0,0,0,0.12)]"
              }`}
            />
          </div>

          {/* Alt Marka Etiketi */}
          <div className="mt-1 flex items-center justify-center gap-1.5 text-[9px] font-mono tracking-wider uppercase">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                themeMode === "dark"
                  ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)] animate-pulse"
                  : "bg-zinc-800"
              }`}
            />
            <span
              className={`font-semibold ${
                themeMode === "dark"
                  ? "text-zinc-300 group-hover:text-emerald-300"
                  : "text-zinc-800"
              }`}
            >
              VOXSUB STUDIO
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
