import Image from "next/image";
import { Check } from "lucide-react";
import { LeaderboardItemData, ThemeMode } from "@/types/follow-list";

type LeaderboardItemProps = {
  data: LeaderboardItemData;
  theme: ThemeMode;
};

export function LeaderboardItem({ data, theme }: LeaderboardItemProps) {
  const { rank, name, handle, avatarUrl, isVerified, actionType, actionImage } = data;
  const isDark = theme === "dark";

  let rankColorClass = isDark ? "text-white" : "text-black";
  if (rank === 1) rankColorClass = "text-yellow-400";
  if (rank === 2) rankColorClass = "text-cyan-400";
  if (rank === 3) rankColorClass = "text-emerald-400";
  if (rank >= 4) rankColorClass = `${isDark ? "text-white" : "text-gray-700"} font-bold`;

  const hoverClass = isDark ? "hover:bg-white/5" : "hover:bg-black/5";
  const nameClass = isDark ? "text-white" : "text-gray-900";
  const handleClass = isDark ? "text-gray-400" : "text-gray-500";

  const castBtnClass = isDark
    ? "bg-white/10 hover:bg-white/20 text-white border-white/10"
    : "bg-black/5 hover:bg-black/10 text-gray-900 border-black/5";

  const followBtnClass = isDark ? "bg-white text-black hover:bg-gray-200" : "bg-black text-white hover:bg-gray-800";

  return (
    <div className={`flex items-center justify-between py-3 group rounded-lg px-2 transition-colors ${hoverClass}`}>
      <div className="flex items-center gap-3">
        <span className={`w-4 text-center text-sm font-bold ${rankColorClass} font-mono`}>{rank}</span>

        <div className="relative">
          <Image
            src={avatarUrl}
            alt={name}
            width={40}
            height={40}
            sizes="40px"
            className={`w-10 h-10 rounded-full object-cover border ${isDark ? "border-white/10" : "border-black/5"}`}
          />
        </div>

        <div className="flex flex-col">
          <div className="flex items-center gap-1">
            <span className={`text-sm font-semibold leading-tight ${nameClass}`}>{name}</span>
            {isVerified && (
              <div className={`${isDark ? "bg-white text-black" : "bg-blue-500 text-white"} rounded-full p-[1px]`}>
                <Check className="w-2 h-2 stroke-[4]" />
              </div>
            )}
          </div>
          <span className={`text-xs leading-tight ${handleClass}`}>{handle}</span>
        </div>
      </div>

      <div>
        {actionType === "cast" && (
          <button className={`px-4 py-1.5 text-xs font-medium rounded-full border transition-all ${castBtnClass}`}>Cast</button>
        )}

        {actionType === "follow" && (
          <button
            className={`px-4 py-1.5 text-xs font-bold rounded-full transition-all flex items-center gap-1 ${followBtnClass}`}
          >
            Follow
          </button>
        )}

        {actionType === "image" && actionImage && (
          <div className={`w-10 h-14 rounded overflow-hidden border ${isDark ? "border-white/10" : "border-black/10"}`}>
            <Image src={actionImage} alt="content" width={40} height={56} sizes="40px" className="w-full h-full object-cover" />
          </div>
        )}
      </div>
    </div>
  );
}
