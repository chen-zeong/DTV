"use client";

import { HomeShell } from "@/components/home-shell";
import { Platform } from "@/types/platform";

export default function BilibiliPage() {
  return (
    <HomeShell initialPlatform={Platform.BILIBILI} showInput={false} />
  );
}
