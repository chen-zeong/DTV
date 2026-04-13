"use client";

import React, { useMemo } from "react";

import { MainPlayer } from "@/components/player/MainPlayer";
import { Platform } from "@/platforms/common/types";

function toPlatformEnum(p: string): Platform {
  const key = (p || "").toLowerCase();
  if (key === "douyin") return Platform.DOUYIN;
  if (key === "huya") return Platform.HUYA;
  if (key === "bilibili") return Platform.BILIBILI;
  return Platform.DOUYU;
}

export function PlayerPage({ platform, roomId }: { platform: string; roomId: string }) {
  const plat = useMemo(() => toPlatformEnum(platform), [platform]);
  if (!roomId) {
    return (
      <div style={{ padding: 18, color: "var(--secondary-text)", fontWeight: 700 }}>
        无效的房间 ID。
      </div>
    );
  }
  return <MainPlayer platform={plat} roomId={roomId} />;
}
