"use client";

import { useEffect, useRef } from "react";
import { DanmakuMessage } from "@/types/danmaku";
import { type ThemeResolved } from "@/stores/theme-store";

type DanmakuPanelProps = {
  messages: DanmakuMessage[];
  className?: string;
  style?: React.CSSProperties;
  theme?: ThemeResolved;
};

export function DanmakuPanel({ messages, className, style, theme }: DanmakuPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isDark = theme === "dark";

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div
      ref={containerRef}
      className={`w-full md:w-[280px] lg:w-[300px] h-full overflow-y-auto no-scrollbar rounded-xl border p-3 backdrop-blur-xl shadow-lg ${
        isDark ? "border-white/10 bg-white/5" : "border-gray-200 bg-white"
      } ${className || ""}`}
      style={style}
    >
      <div className="flex items-center justify-between mb-2">
        <div className={`text-[11px] tracking-[0.18em] uppercase ${isDark ? "text-gray-300" : "text-gray-600"}`}>弹幕</div>
        <div className={`text-[11px] ${isDark ? "text-gray-400" : "text-gray-500"}`}>{messages.length} 条</div>
      </div>
      <div className="space-y-2 text-sm">
        {messages.slice(-200).map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-2 items-start rounded-lg px-2 py-2 border ${
              isDark ? "bg-white/5 border-white/5" : "bg-gray-50 border-gray-200"
            }`}
          >
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold uppercase ${
                isDark ? "bg-gradient-to-br from-white/15 to-white/5 text-white" : "bg-gray-200 text-gray-800"
              }`}
            >
              {msg.nickname?.slice(0, 1) || "?"}
            </div>
            <div className="flex-1">
              <div className={`text-[12px] ${isDark ? "text-gray-300" : "text-gray-600"}`}>{msg.nickname}</div>
              <div className={`leading-snug break-words ${isDark ? "text-white/90" : "text-gray-900"}`}>{msg.content}</div>
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
