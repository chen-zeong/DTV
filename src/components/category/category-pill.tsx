"use client";

import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

type CategoryPillProps = {
  label?: string;
  children?: ReactNode;
  active?: boolean;
  isDark: boolean;
  size?: "md" | "sm";
  className?: string;
  onClick?: () => void;
  title?: string;
};

export function CategoryPill({ label, children, active = false, isDark, size = "md", className, onClick, title }: CategoryPillProps) {
  const content = children ?? label ?? "";
  const sizeClass = size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm";
  const activeClass = isDark
    ? "bg-white text-gray-900 shadow-[0_10px_30px_-12px_rgba(255,255,255,0.6)] border-transparent"
    : "bg-gray-900 text-white shadow-[0_10px_30px_-12px_rgba(0,0,0,0.35)] border-transparent";
  const inactiveClass = isDark
    ? "bg-white/6 text-gray-200 border border-white/12 hover:bg-white/12"
    : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50";

  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "inline-flex items-center gap-2 rounded-2xl whitespace-nowrap transition-all duration-200 backdrop-blur-md",
        sizeClass,
        active ? activeClass : inactiveClass,
        className
      )}
    >
      {content}
    </button>
  );
}
