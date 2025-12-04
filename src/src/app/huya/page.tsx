"use client";

import { HomeShell } from "@/components/home-shell";
import { Platform } from "@/types/platform";
import { HuyaHome } from "@/components/home/huya-home";

export default function HuyaPage() {
  return (
    <HomeShell initialPlatform={Platform.HUYA} showInput={false}>
      <HuyaHome />
    </HomeShell>
  );
}
