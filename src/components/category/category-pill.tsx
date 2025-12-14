"use client";

import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

type CategoryPillProps = {
  label?: string;
  children?: ReactNode;
  active?: boolean;
  isDark: boolean;
  size?: "md" | "sm";
  variant?: "pill" | "tab";
  className?: string;
  onClick?: () => void;
  title?: string;
};

export function CategoryPill({
  label,
  children,
  active = false,
  isDark,
  size = "md",
  variant = "pill",
  className,
  onClick,
  title,
}: CategoryPillProps) {
  const content = children ?? label ?? "";
  const isTab = variant === "tab";

  const baseClass = isTab
    ? "relative flex items-center gap-1 rounded-none transition-colors duration-200 min-w-fit whitespace-nowrap border-b-2 border-transparent"
    : "flex items-center gap-2.5 rounded-2xl transition-all duration-300 min-w-max";

  const sizeClass =
    variant === "pill"
      ? size === "sm"
        ? "px-3 py-1.5 text-xs min-w-fit"
        : "px-4 py-2.5 text-sm"
      : size === "sm"
        ? "px-1.5 pb-1 text-xs"
        : "px-1.5 pb-1.5 text-sm";

  const activeClass = isTab
    ? isDark
      ? "text-white font-semibold border-emerald-400"
      : "text-gray-900 font-semibold border-emerald-500"
    : isDark
      ? "bg-white/20 backdrop-blur-xl border border-white/40 text-white shadow-[0_0_15px_rgba(255,255,255,0.15)]"
      : "bg-[#eef2f7] text-slate-700 border border-[#c5ccd8] shadow-[0_10px_28px_-20px_rgba(17,24,39,0.25)] ring-1 ring-[#e2e7ef] font-semibold";

  const inactiveClass = isTab
    ? isDark
      ? "text-gray-400 hover:text-white/90"
      : "text-gray-500 hover:text-gray-900"
    : isDark
      ? "bg-white/5 backdrop-blur-sm border border-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
      : "bg-white/95 backdrop-blur-md border border-[#dfe3ec] text-slate-700 hover:bg-[#f7f9fc] hover:text-slate-900 shadow-[0_10px_26px_-22px_rgba(17,24,39,0.18)]";

  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        baseClass,
        sizeClass,
        active ? activeClass : inactiveClass,
        className
      )}
    >
      {content}
    </button>
  );
}
