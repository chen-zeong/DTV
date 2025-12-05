"use client";

import { HomeShell } from "@/components/home-shell";
import { Platform } from "@/types/platform";

export default function HuyaPage() {
  return (
    <HomeShell initialPlatform={Platform.HUYA} showInput={false} />
  );
}
