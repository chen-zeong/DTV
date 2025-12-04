import {
  Flame,
  Fish,
  Moon,
  MoreHorizontal,
  Music2,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
  Sun,
} from "lucide-react";
import { ThemeMode } from "@/types/leaderboard";
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

  const containerClass = isDark ? "bg-black border-gray-800" : "bg-white border-gray-200 shadow-xl";

  const iconClass = `w-6 h-6 transition-colors cursor-pointer ${
    isDark ? "text-gray-400 hover:text-white" : "text-gray-500 hover:text-black"
  }`;

  const activeIconContainerClass = `p-2 rounded-xl border transition-all ${
    isDark ? "bg-gray-800/80 border-gray-700 text-white" : "bg-gray-100 border-gray-300 text-black"
  }`;

  return (
    <div
      className={`flex flex-col items-center justify-between py-6 w-[72px] h-full border-r z-50 transition-colors duration-300 ${containerClass} ${className}`}
    >
      <div className="flex flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-4">
          <button
            className={`${iconClass} ${activePlatform === "ALL" ? activeIconContainerClass : ""} p-2 rounded-xl border-transparent`}
            onClick={() => onSelectPlatform("ALL")}
            aria-label="全部平台"
          >
            <Sparkles className="w-6 h-6" />
          </button>
          <button
            className={`${activePlatform === Platform.DOUYU ? activeIconContainerClass : ""} p-2 rounded-xl transition-colors`}
            onClick={() => onSelectPlatform(Platform.DOUYU)}
            aria-label="斗鱼"
          >
            <Fish className={`${iconClass} w-6 h-6`} />
          </button>
          <button
            className={`${activePlatform === Platform.HUYA ? activeIconContainerClass : ""} p-2 rounded-xl transition-colors`}
            onClick={() => onSelectPlatform(Platform.HUYA)}
            aria-label="虎牙"
          >
            <Flame className={`${iconClass} w-6 h-6`} />
          </button>
          <button
            className={`${activePlatform === Platform.BILIBILI ? activeIconContainerClass : ""} p-2 rounded-xl transition-colors`}
            onClick={() => onSelectPlatform(Platform.BILIBILI)}
            aria-label="哔哩哔哩"
          >
            <Sparkles className={`${iconClass} w-6 h-6`} />
          </button>
          <button
            className={`${activePlatform === Platform.DOUYIN ? activeIconContainerClass : ""} p-2 rounded-xl transition-colors`}
            onClick={() => onSelectPlatform(Platform.DOUYIN)}
            aria-label="抖音"
          >
            <Music2 className={`${iconClass} w-6 h-6`} />
          </button>
        </div>

        <div className="flex flex-col items-center gap-6">
          <button onClick={toggleLeaderboard} title="Toggle Follow List" className="focus:outline-none">
            {isLeaderboardOpen ? <PanelLeftClose className={iconClass} /> : <PanelLeftOpen className={iconClass} />}
          </button>

          <button onClick={toggleTheme} title="Toggle Theme" className="focus:outline-none">
            {isDark ? <Sun className={iconClass} /> : <Moon className={iconClass} />}
          </button>

          <MoreHorizontal className={iconClass} />
        </div>
      </div>
    </div>
  );
}
