import Image from "next/image";
import { Moon, PanelLeftClose, PanelLeftOpen, Sun } from "lucide-react";
import { motion } from "framer-motion";
import { ThemeMode } from "@/types/follow-list";
import { Platform } from "@/types/platform";

type SidebarProps = {
  className?: string;
  theme: ThemeMode;
  toggleTheme: () => void;
  isLeaderboardOpen: boolean;
  toggleLeaderboard: () => void;
  activePlatform: Platform | "ALL";
  onSelectPlatform: (platform: Platform | "ALL") => void;
};

export function Sidebar({
  className,
  theme,
  toggleTheme,
  isLeaderboardOpen,
  toggleLeaderboard,
  activePlatform,
  onSelectPlatform,
}: SidebarProps) {
  const isDark = theme === "dark";

  const containerClass = isDark
    ? "bg-gradient-to-b from-[#0b0c12] via-[#0f111a] to-[#0b0c12] border-gray-800/70"
    : "bg-gradient-to-b from-white via-[#f4f7ff] to-white border-gray-200 shadow-xl";

  const iconClass = `w-6 h-6 transition-all cursor-pointer ${isDark ? "opacity-70 hover:opacity-100" : "opacity-80 hover:opacity-100"}`;
  const activeIconContainerClass = `p-2 rounded-2xl border ring-2 ring-offset-2 transition-all ${
    isDark
      ? "bg-white/5 border-white/10 ring-emerald-400/40 ring-offset-[#0f111a]"
      : "bg-white border-gray-200 ring-blue-400/40 ring-offset-white"
  }`;

  const platforms: Array<{ platform: Platform; label: string; logo: string }> = [
    { platform: Platform.DOUYU, label: "斗鱼", logo: "/logos/douyu.webp" },
    { platform: Platform.HUYA, label: "虎牙", logo: "/logos/huya.webp" },
    { platform: Platform.BILIBILI, label: "哔哩哔哩", logo: "/logos/bilibili.webp" },
    { platform: Platform.DOUYIN, label: "抖音", logo: "/logos/douyin.webp" },
  ];

  return (
    <div
      className={`flex flex-col items-center justify-between py-5 w-[80px] h-full border-r z-50 transition-colors duration-300 ${containerClass} ${className}`}
    >
      <div className="flex flex-col items-center gap-4">
        <div className="flex flex-col items-center gap-3">
          {platforms.map((item) => {
            const isActive = activePlatform === item.platform;
            return (
              <motion.button
                key={item.platform}
                className={`${isActive ? activeIconContainerClass : "p-2 rounded-2xl"} relative overflow-hidden`}
                onClick={() => onSelectPlatform(item.platform)}
                aria-label={item.label}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                transition={{ type: "spring", stiffness: 220, damping: 18 }}
              >
                {isActive && (
                  <motion.span
                    className="absolute inset-0 rounded-2xl bg-gradient-to-br from-emerald-400/30 via-transparent to-cyan-400/20 blur-md"
                    transition={{ type: "tween", duration: 0.25 }}
                  />
                )}
                <div className="relative flex items-center justify-center">
                  <Image
                    src={item.logo}
                    alt={item.label}
                    width={32}
                    height={32}
                    className={`${iconClass} w-8 h-8 object-contain drop-shadow`}
                    priority
                  />
                  {isActive && (
                    <span className="absolute inset-0 rounded-2xl ring-2 ring-emerald-300/60 shadow-[0_6px_20px_-6px_rgba(16,185,129,0.7)]" />
                  )}
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col items-center gap-4 pb-2">
        <button
          onClick={toggleLeaderboard}
          title="展开/收起关注列表"
          className={`p-2 rounded-2xl border transition-colors ${isDark ? "border-white/10 bg-white/5" : "border-gray-200 bg-white"}`}
        >
          {isLeaderboardOpen ? <PanelLeftClose className={iconClass} /> : <PanelLeftOpen className={iconClass} />}
        </button>

        <button
          onClick={toggleTheme}
          title="切换主题"
          className={`p-2 rounded-2xl border transition-colors ${isDark ? "border-white/10 bg-white/5" : "border-gray-200 bg-white"}`}
        >
          {isDark ? <Sun className={iconClass} /> : <Moon className={iconClass} />}
        </button>
      </div>
    </div>
  );
}
