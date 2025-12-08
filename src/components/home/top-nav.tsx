import { Platform } from "@/types/platform";
import { platformLabelMap } from "@/utils/platform";
import { SearchPanel } from "@/components/search/search-panel";
import { Github, Moon, Sun } from "lucide-react";
import { openLink } from "@/lib/tauri";
import { cn } from "@/utils/cn";
import type { ThemeResolved } from "@/stores/theme-store";

type NavPlatform = Platform | "ALL" | "FOLLOW";

type HomeTopNavProps = {
  theme: ThemeResolved;
  activePlatform: NavPlatform;
  onPlatformChange?: (p: NavPlatform) => void;
  showSearch?: boolean;
};

export function HomeTopNav({ theme, activePlatform, onPlatformChange, showSearch = true }: HomeTopNavProps) {
  const isDark = theme === "dark";
  return (
    <div className="grid w-full grid-cols-[1fr,auto] items-center gap-3">
      <div className="flex justify-center">
        <div
          className={cn(
            "flex items-center gap-2 rounded-full border px-2.5 py-1.5 shadow-lg backdrop-blur-xl",
            isDark ? "bg-white/10 border-white/10 shadow-black/40" : "bg-white border-gray-200 shadow-gray-300/60"
          )}
        >
          {[Platform.DOUYU, Platform.HUYA, Platform.BILIBILI, Platform.DOUYIN].map((p) => {
            const isActive = activePlatform === p;
            const label = platformLabelMap[p];
            return (
              <button
                key={p}
                onClick={() => onPlatformChange?.(p)}
                className={cn(
                  "px-3 py-1.5 text-sm font-semibold rounded-full transition-all",
                  isActive
                    ? isDark
                      ? "bg-white text-gray-900 shadow-[0_10px_30px_-12px_rgba(255,255,255,0.8)]"
                      : "bg-gray-900 text-white shadow-[0_10px_30px_-12px_rgba(0,0,0,0.35)]"
                    : isDark
                      ? "text-gray-200 hover:text-white hover:bg-white/10"
                      : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        {showSearch ? (
          <SearchPanel platform={activePlatform === "ALL" ? Platform.DOUYU : (activePlatform as Platform)} />
        ) : null}
        <a
          href="https://github.com/chen-zeong/DTV"
          target="_blank"
          rel="noreferrer"
          onClick={() => void openLink("https://github.com/chen-zeong/DTV")}
          className={cn(
            "p-2 rounded-full border transition-colors",
            isDark ? "border-white/10 bg-white/10 hover:bg-white/15" : "border-gray-200 bg-white hover:bg-gray-100"
          )}
          title="打开 GitHub"
        >
          <Github className="w-5 h-5" />
        </a>
        <button
          onClick={() => {
            const ev = new CustomEvent("toggle-theme");
            window.dispatchEvent(ev);
          }}
          className={cn(
            "p-2 rounded-full border transition-colors",
            isDark ? "border-white/10 bg-white/10 hover:bg-white/15" : "border-gray-200 bg-white hover:bg-gray-100"
          )}
          title="切换主题"
        >
          {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>
      </div>
    </div>
  );
}
