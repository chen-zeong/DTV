"use client";

import React from "react";
import { useSearchParams } from "next/navigation";

import { PlayerPage } from "@/screens/PlayerPage";

export default function PlayerContent() {
  const searchParams = useSearchParams();
  const platform = (searchParams.get("platform") || "douyu").toLowerCase();
  const roomId = searchParams.get("roomId") || "";

  if (!roomId) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          flex: 1,
          minHeight: 0,
          color: "var(--secondary-text)",
          fontWeight: 700
        }}
      >
        <div>
          <div style={{ fontSize: 16, marginBottom: 8 }}>未指定房间 ID</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>请从主播列表进入直播间</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      <PlayerPage platform={platform} roomId={roomId} />
    </div>
  );
}
