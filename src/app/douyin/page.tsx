"use client";

import { HomeShell } from "@/components/home-shell";
import { Platform } from "@/types/platform";

export default function DouyinPage() {
  return (
    <HomeShell initialPlatform={Platform.DOUYIN} showInput={false} />
  );
}
