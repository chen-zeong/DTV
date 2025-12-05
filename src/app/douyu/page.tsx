"use client";

import { HomeShell } from "@/components/home-shell";
import { Platform } from "@/types/platform";

export default function DouyuPage() {
  return (
    <HomeShell initialPlatform={Platform.DOUYU} showInput={false} />
  );
}
