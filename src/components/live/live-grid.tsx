"use client";

import Image from "next/image";
import { Eye } from "lucide-react";
import { cn } from "@/utils/cn";
import { ReactNode } from "react";

export type LiveCardItem = {
  id: string;
  title: string;
  subtitle?: string | null;
  cover?: string | null;
  avatar?: string | null;
  viewerText?: string | null;
};

type LiveGridProps = {
  items: LiveCardItem[];
  onCardClick: (item: LiveCardItem) => void;
  renderActions?: (item: LiveCardItem) => ReactNode;
  className?: string;
};

type LiveGridSkeletonProps = {
  count?: number;
  className?: string;
};

export function LiveGrid({ items, onCardClick, renderActions, className }: LiveGridProps) {
  if (!items.length) return null;
  const idCounts: Record<string, number> = {};
  items.forEach((item) => {
    idCounts[item.id] = (idCounts[item.id] || 0) + 1;
  });
  const used: Record<string, number> = {};
  return (
    <div
      className={cn(
        "grid gap-4 grid-cols-2",
        "sm:grid-cols-[repeat(auto-fit,minmax(240px,240px))] sm:justify-start",
        className
      )}
    >
      {items.map((item) => {
        const occur = (used[item.id] = (used[item.id] || 0) + 1);
        const key = idCounts[item.id] > 1 ? `${item.id}-${occur}` : item.id;
        return (
        <div
          key={key}
          className="group relative overflow-hidden rounded-3xl border border-white/30 dark:border-white/10 transition-all duration-300 hover:-translate-y-1 cursor-pointer"
          style={{
            backgroundColor: "var(--color-card, rgba(255,255,255,0.4))",
            boxShadow:
              "0 40px 50px -32px rgba(0, 0, 0, 0.05), inset 0 0 20px rgba(255, 255, 255, 0.25)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
          onClick={() => onCardClick(item)}
        >
          <div className="relative">
            {item.cover ? (
              <Image src={item.cover} alt={item.title} width={640} height={360} className="w-full aspect-video object-cover" />
            ) : (
              <div className="w-full aspect-video bg-gray-100 dark:bg-white/5" />
            )}
            {item.viewerText ? (
              <div className="absolute top-2 right-2 inline-flex items-center gap-1 text-xs bg-black/45 text-white backdrop-blur px-2.5 py-1.5 rounded-full shadow-sm">
                <Eye className="w-4 h-4" />
                <span>{item.viewerText}</span>
              </div>
            ) : null}
          </div>
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              {item.avatar ? (
                <Image
                  src={item.avatar}
                  alt={item.subtitle || item.title}
                  width={40}
                  height={40}
                  className="w-11 h-11 rounded-2xl object-cover ring-1 ring-black/5 dark:ring-white/10"
                />
              ) : (
                <div className="w-11 h-11 rounded-2xl bg-gray-100 text-gray-600 flex items-center justify-center text-sm ring-1 ring-black/5 dark:bg-white/10 dark:text-white/70 dark:ring-white/10">
                  {(item.subtitle || item.title).slice(0, 1)}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-semibold text-gray-900 truncate dark:text-white">{item.title}</div>
                {item.subtitle ? <div className="text-xs text-gray-500 truncate dark:text-gray-400">{item.subtitle}</div> : null}
              </div>
            </div>
            {renderActions ? <div onClick={(e) => e.stopPropagation()}>{renderActions(item)}</div> : null}
          </div>
        </div>
      );
      })}
    </div>
  );
}

export function LiveGridSkeleton({ count = 18, className }: LiveGridSkeletonProps) {
  return (
    <div
      className={cn(
        "grid gap-4 grid-cols-2",
        "sm:grid-cols-[repeat(auto-fit,minmax(240px,240px))] sm:justify-start",
        className
      )}
    >
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          className="relative overflow-hidden rounded-3xl border border-white/30 dark:border-white/10 animate-pulse"
          style={{
            backgroundColor: "var(--color-card, rgba(255,255,255,0.4))",
            boxShadow:
              "0 40px 50px -32px rgba(0, 0, 0, 0.05), inset 0 0 20px rgba(255, 255, 255, 0.25)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
        >
          <div className="w-full aspect-video bg-gray-200/70 dark:bg-white/10" />
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-11 h-11 rounded-2xl bg-gray-200/80 dark:bg-white/10" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 rounded bg-gray-200/80 dark:bg-white/10 w-3/4" />
                <div className="h-3 rounded bg-gray-200/70 dark:bg-white/10 w-2/3" />
              </div>
            </div>
            <div className="h-3 rounded bg-gray-200/70 dark:bg-white/10 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
