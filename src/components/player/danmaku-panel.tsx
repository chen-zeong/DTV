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
      className={`w-full md:w-[200px] lg:w-[220px] h-full overflow-y-auto no-scrollbar rounded-2xl border p-3.5 backdrop-blur-xl shadow-[0_20px_60px_-30px_rgba(0,0,0,0.45)] ${
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
        {messages.slice(-200).map((msg, idx) => (
          <div
            key={msg.id}
            className={`rounded-xl px-3 py-2.5 ring-1 ${
              isDark
                ? "bg-white/5 ring-white/10 hover:ring-white/20 hover:bg-white/10"
                : "bg-white/80 ring-gray-200 hover:ring-gray-300 hover:bg-white"
            } transition-colors`}
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-[12px] font-semibold">
                {msg.level ? (
                  <span
                    className={`px-1.5 py-0.5 rounded-md text-[10px] font-semibold ${
                      isDark ? "bg-white/10 text-gray-200" : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    Lv.{msg.level}
                  </span>
                ) : null}
                <span
                  className={cn("truncate", pickNameColor(msg, idx))}
                  title={msg.nickname}
                >
                  {msg.nickname}
                </span>
              </div>
              <div className={`leading-snug break-words ${isDark ? "text-gray-200" : "text-gray-700"}`}>{msg.content}</div>
            </div>
          </div>
        ))}
        {messages.length === 0 && (
          <div className={`text-xs ${isDark ? "text-gray-500" : "text-gray-500"}`}>等待弹幕...</div>
        )}
      </div>
    </div>
  );
}
