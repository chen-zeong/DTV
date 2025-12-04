"use client";

import { DanmakuMessage } from "@/types/danmaku";

type DanmakuPanelProps = {
  messages: DanmakuMessage[];
  className?: string;
  style?: React.CSSProperties;
};

export function DanmakuPanel({ messages, className, style }: DanmakuPanelProps) {
  return (
    <div
      className={`w-full md:w-80 h-full max-h-[50vh] md:max-h-full overflow-y-auto rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur-lg ${className || ""}`}
      style={style}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs uppercase tracking-[0.2em] text-gray-400">弹幕</div>
        <div className="text-[11px] text-gray-500">{messages.length} 条</div>
      </div>
      <div className="space-y-2 text-sm">
        {messages.slice(-200).map((msg) => (
          <div key={msg.id} className="flex gap-2 items-start">
            <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-semibold uppercase">
              {msg.nickname?.slice(0, 1) || "?"}
            </div>
            <div className="flex-1">
              <div className="text-[12px] text-gray-300">{msg.nickname}</div>
              <div className="text-white/90 leading-snug">{msg.content}</div>
            </div>
          </div>
        ))}
        {messages.length === 0 && <div className="text-xs text-gray-500">等待弹幕...</div>}
      </div>
    </div>
  );
}
