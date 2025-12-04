"use client";

import { HomeShell } from "@/components/home-shell";
import { Platform } from "@/types/platform";
import { DouyinHome } from "@/components/home/douyin-home";

export default function DouyinPage() {
  return (
    <HomeShell initialPlatform={Platform.DOUYIN} showInput={false}>
      <DouyinHome />
    </HomeShell>
  );
}
