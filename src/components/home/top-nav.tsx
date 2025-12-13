import { Platform } from "@/types/platform";
import { platformLabelMap } from "@/utils/platform";
import { SearchPanel } from "@/components/search/search-panel";
import { Github, Moon, Sun } from "lucide-react";
import { openLink } from "@/lib/tauri";
import { cn } from "@/utils/cn";
import type { ThemeResolved } from "@/stores/theme-store";
import { motion, MotionConfig } from "framer-motion";

type NavPlatform = Platform | "ALL" | "FOLLOW";

type HomeTopNavProps = {
  theme: ThemeResolved;
  activePlatform: NavPlatform;
  onPlatformChange?: (p: NavPlatform) => void;
  showSearch?: boolean;
  onToggleTheme?: () => void;
};

export function HomeTopNav({
  theme,
  activePlatform,
  onPlatformChange,
  showSearch = true,
  onToggleTheme,
}: HomeTopNavProps) {
  const isDark = theme === "dark";
  const spring = { type: "spring", stiffness: 240, damping: 28, mass: 1.05 };
  const pillSpring = { type: "spring", stiffness: 200, damping: 30, mass: 1.1 };
  return (
    <MotionConfig transition={spring}>
      <div className="grid w-full grid-cols-[auto,1fr,auto] items-center gap-3">
        <div
          className="flex items-center gap-2 invisible pointer-events-none"
          aria-hidden
          style={{ minWidth: showSearch ? 220 : 96 }}
        >
          <div className="h-10 w-[120px]" />
          <div className="h-10 w-10 rounded-full border" />
          <div className="h-10 w-10 rounded-full border" />
        </div>

        <div className="flex justify-center">
          <motion.div
            layout
            className={cn(
              "flex items-center gap-2 rounded-full border px-2.5 py-1.5 shadow-lg backdrop-blur-xl relative",
              isDark ? "bg-white/10 border-white/10 shadow-black/40" : "bg-white border-gray-200 shadow-gray-300/60"
            )}
          >
            {[Platform.DOUYU, Platform.HUYA, Platform.BILIBILI, Platform.DOUYIN].map((p) => {
              const isActive = activePlatform === p;
              const label = platformLabelMap[p];
              return (
                <div key={p} className="relative">
                  {isActive ? (
                    <motion.div
                      layoutId="platform-pill"
                      className={cn(
                        "absolute inset-0 rounded-full",
                        isDark
                          ? "bg-white text-gray-900 shadow-[0_10px_30px_-12px_rgba(255,255,255,0.7)]"
                          : "bg-gray-900 text-white shadow-[0_10px_30px_-12px_rgba(0,0,0,0.4)]"
                      )}
                      transition={pillSpring}
                      layout
                    />
                  ) : null}
                  <motion.button
                    layout
                    onClick={() => onPlatformChange?.(p)}
                    className={cn(
                      "relative px-3 py-1.5 text-sm font-semibold rounded-full transition-colors",
                      isActive
                        ? isDark
                          ? "text-gray-900"
                          : "text-white"
                        : isDark
                        ? "text-gray-200 hover:text-white"
                        : "text-gray-600 hover:text-gray-900"
                    )}
                    whileTap={{ scale: 0.97 }}
                    whileHover={{ y: -1.5, scale: 1.015 }}
                    transition={spring}
                  >
                    <span className="relative z-10">{label}</span>
                  </motion.button>
                </div>
              );
            })}
          </motion.div>
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
              onToggleTheme?.();
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
    </MotionConfig>
  );
}
