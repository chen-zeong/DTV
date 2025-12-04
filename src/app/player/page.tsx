"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { PlayerView } from "@/components/player/player-view";
import { Platform } from "@/types/platform";
import { useMemo } from "react";
import { HomeShell } from "@/components/home-shell";

const platformMap: Record<string, Platform> = {
  douyu: Platform.DOUYU,
  huya: Platform.HUYA,
  bilibili: Platform.BILIBILI,
  douyin: Platform.DOUYIN,
};

export default function PlayerPage() {
  const params = useSearchParams();
  const router = useRouter();
  const platformKey = params.get("platform") || "";
  const roomId = params.get("roomId") || "";

  const platform = useMemo(() => platformMap[platformKey.toLowerCase()], [platformKey]);

  if (!platform || !roomId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-black text-white gap-3">
        <div className="text-lg font-semibold">缺少 platform 或 roomId 参数</div>
        <button
          className="px-4 py-2 rounded-full border border-white/20 bg-white/10 hover:bg-white/20 text-sm"
          onClick={() => router.push("/douyu")}
        >
          返回首页
        </button>
      </div>
    );
  }

  return (
    <HomeShell initialPlatform={platform} initialLeaderboardOpen={false} showInput={false} showSearch={false}>
      <div className="h-full">
        <PlayerView platform={platform} roomId={roomId} />
      </div>
    </HomeShell>
  );
}
