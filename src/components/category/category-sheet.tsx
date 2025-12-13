"use client";

import { cn } from "@/utils/cn";

export type CategorySheetItem = {
  id: string;
  label: string;
};

type CategorySheetProps = {
  title: string;
  items: CategorySheetItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  isDark: boolean;
  columns?: 2 | 3;
};

export function CategorySheet({ title, items, activeId, onSelect, onClose, isDark, columns = 2 }: CategorySheetProps) {
  const colClass = columns === 3 ? "grid-cols-3" : "grid-cols-2";
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end justify-center">
      <div
        className={cn(
          "w-full max-h-[80vh] rounded-t-2xl p-4 space-y-3",
          isDark ? "bg-[#0f111a] text-white" : "bg-white text-gray-900"
        )}
      >
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">{title}</div>
          <button
            onClick={onClose}
            className={cn(
              "text-xs px-3 py-1 rounded-full border transition-colors",
              isDark ? "border-white/15 hover:bg-white/10" : "border-gray-200 hover:bg-gray-100"
            )}
          >
            关闭
          </button>
        </div>
        <div className={cn("grid gap-2 overflow-y-auto no-scrollbar max-h-[65vh]", colClass)}>
          {items.map((item) => {
            const active = activeId === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelect(item.id)}
                className={cn(
                  "px-3 py-2 rounded-xl text-sm text-left border transition-colors",
                  active
                    ? "bg-white text-gray-900 border-transparent font-semibold"
                    : isDark
                      ? "bg-white/8 text-white border-white/12 hover:bg-white/12"
                      : "bg-white text-gray-800 border-gray-200 hover:bg-gray-50"
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
