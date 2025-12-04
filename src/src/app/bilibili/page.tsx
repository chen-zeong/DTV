"use client";

import { HomeShell } from "@/components/home-shell";
import { Platform } from "@/types/platform";
import { BilibiliHome } from "@/components/home/bilibili-home";

export default function BilibiliPage() {
  return (
    <HomeShell initialPlatform={Platform.BILIBILI} showInput={false}>
      <BilibiliHome />
    </HomeShell>
  );
}
