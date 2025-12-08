"use client";

import { useEffect, useRef } from "react";
import { DanmakuMessage } from "@/types/danmaku";
import { type ThemeResolved } from "@/stores/theme-store";
import { cn } from "@/utils/cn";

type DanmakuPanelProps = {
  messages: DanmakuMessage[];
  className?: string;
  style?: React.CSSProperties;
  theme?: ThemeResolved;
};

export function DanmakuPanel({ messages, className, style, theme }: DanmakuPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isDark = theme === "dark";
  const namePaletteDark = ["text-emerald-300", "text-sky-300", "text-amber-300", "text-pink-300", "text-indigo-300", "text-lime-300"];
  const namePaletteLight = ["text-emerald-700", "text-sky-700", "text-amber-700", "text-pink-600", "text-indigo-700", "text-lime-700"];

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const pickNameColor = (msg: DanmakuMessage, index: number) => {
    const colors = isDark ? namePaletteDark : namePaletteLight;
    let hash = index;
    const key = msg.id || msg.nickname || "";
    for (let i = 0; i < key.length; i++) {
      hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    }
    return colors[hash % colors.length];
  };

  return (
    <div
      ref={containerRef}
      className={`w-full md:w-[200px] lg:w-[220px] h-full max-h-[70vh] md:max-h-[80vh] overflow-y-auto no-scrollbar rounded-2xl border p-3.5 backdrop-blur-xl shadow-[0_20px_60px_-30px_rgba(0,0,0,0.45)] ${
        isDark
          ? "border-white/10 bg-gradient-to-b from-[#0d111a]/90 via-[#0d111a]/70 to-[#0f1625]/80"
          : "border-gray-200/70 bg-gradient-to-b from-white via-white to-[#f6f8fb]"
      } ${className || ""}`}
      style={style}
    >
      <div className="flex items-center justify-between mb-3">
        <div
          className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-semibold tracking-[0.16em] uppercase ${
            isDark ? "bg-white/10 text-white" : "bg-gray-100 text-gray-800"
          }`}
        >
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.15)]" />
          弹幕
        </div>
        <div className={`text-[11px] px-2 py-1 rounded-full ${isDark ? "text-gray-300 bg-white/5" : "text-gray-600 bg-gray-100"}`}>
          {messages.length} 条
        </div>
      </div>
      <div className="space-y-2.5 text-sm">
        {messages.slice(-200).map((msg, idx) => {
          const accent = msg.color || (isDark ? "#9ae6b4" : "#2563eb");
          return (
            <div key={msg.id} className="space-y-1">
              <div className="flex items-center gap-2 min-w-0">
                {msg.level ? (
                  <span
                    className={cn(
                      "px-1.5 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide shrink-0",
                      isDark ? "bg-white/12 text-gray-200" : "bg-gray-200 text-gray-700"
                    )}
                  >
                    Lv.{msg.level}
                  </span>
                ) : null}
                <span
                  className={cn("text-[13px] font-semibold truncate", pickNameColor(msg, idx))}
                  style={{ color: accent }}
                  title={msg.nickname}
                >
                  {msg.nickname}
                </span>
              </div>
              <div className="flex">
                <div
                  className={cn(
                    "inline-flex max-w-full rounded-2xl px-3 py-2.5 text-sm shadow-lg ring-1",
                    isDark
                      ? "bg-[#1c2331] ring-white/5 text-white shadow-black/35"
                      : "bg-gradient-to-b from-white to-gray-50 ring-gray-200 text-gray-900 shadow-gray-300/60"
                  )}
                  style={{ color: msg.color || undefined }}
                >
                  <span className={cn("leading-snug break-words min-w-0", isDark ? "text-white/90" : "text-gray-800")}>
                    {msg.content}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        {messages.length === 0 && (
          <div className={`text-xs ${isDark ? "text-gray-500" : "text-gray-500"}`}>等待弹幕...</div>
        )}
      </div>
    </div>
  );
}
