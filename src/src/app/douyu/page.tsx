"use client";

import { HomeShell } from "@/components/home-shell";
import { Platform } from "@/types/platform";
import { DouyuHome } from "@/components/home/douyu-home";

export default function DouyuPage() {
  return (
    <HomeShell initialPlatform={Platform.DOUYU} showInput={false}>
      <DouyuHome />
    </HomeShell>
  );
}
