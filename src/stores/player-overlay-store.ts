"use client";

import { create } from "zustand";
import { Platform } from "@/types/platform";

type PlayerOverlayState = {
  isOpen: boolean;
  platform: Platform | null;
  roomId: string | null;
  title?: string | null;
  anchorName?: string | null;
  avatar?: string | null;
};

type PlayerOverlayActions = {
  open: (payload: { platform: Platform; roomId: string; title?: string | null; anchorName?: string | null; avatar?: string | null }) => void;
  close: () => void;
};

export const usePlayerOverlayStore = create<PlayerOverlayState & PlayerOverlayActions>((set) => ({
  isOpen: false,
  platform: null,
  roomId: null,
  title: null,
  anchorName: null,
  avatar: null,
  open: ({ platform, roomId, title, anchorName, avatar }) =>
    set({
      isOpen: true,
      platform,
      roomId,
      title: title ?? null,
      anchorName: anchorName ?? null,
      avatar: avatar ?? null,
    }),
  close: () =>
    set({
      isOpen: false,
      platform: null,
      roomId: null,
      title: null,
      anchorName: null,
      avatar: null,
    }),
}));
