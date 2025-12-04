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

export function LiveGrid({ items, onCardClick, renderActions, className }: LiveGridProps) {
  if (!items.length) return null;
  return (
    <div className={cn("grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4", className)}>
      {items.map((item) => (
        <div
          key={item.id}
          className="group rounded-xl border border-white/10 bg-black/40 overflow-hidden hover:border-white/30 transition-colors cursor-pointer"
          onClick={() => onCardClick(item)}
        >
          <div className="relative">
            {item.cover ? (
              <Image src={item.cover} alt={item.title} width={640} height={360} className="w-full aspect-video object-cover" />
            ) : (
              <div className="w-full aspect-video bg-white/5" />
            )}
            {item.viewerText ? (
              <div className="absolute top-2 right-2 inline-flex items-center gap-1 text-xs bg-black/60 backdrop-blur px-2 py-1 rounded-full">
                <Eye className="w-4 h-4" />
                <span>{item.viewerText}</span>
              </div>
            ) : null}
          </div>
          <div className="p-3 space-y-2">
            <div className="flex items-center gap-2">
              {item.avatar ? (
                <Image
                  src={item.avatar}
                  alt={item.subtitle || item.title}
                  width={40}
                  height={40}
                  className="w-10 h-10 rounded-full object-cover border border-white/10"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-sm text-white/70 border border-white/10">
                  {(item.subtitle || item.title).slice(0, 1)}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-white truncate">{item.title}</div>
                {item.subtitle ? <div className="text-xs text-gray-400 truncate">{item.subtitle}</div> : null}
              </div>
            </div>
            {renderActions ? <div onClick={(e) => e.stopPropagation()}>{renderActions(item)}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
