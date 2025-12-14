"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

type SidebarState = {
  isOpen: boolean;
};

type SidebarActions = {
  toggle: () => void;
  setOpen: (open: boolean) => void;
};

const memoryStore: Record<string, string> = {};
const memoryStorage: Storage = {
  get length() {
    return Object.keys(memoryStore).length;
  },
  clear() {
    for (const key of Object.keys(memoryStore)) delete memoryStore[key];
  },
  getItem(key: string) {
    return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : null;
  },
  key(index: number) {
    const keys = Object.keys(memoryStore);
    return keys[index] ?? null;
  },
  removeItem(key: string) {
    delete memoryStore[key];
  },
  setItem(key: string, value: string) {
    memoryStore[key] = value;
  },
};

export const useSidebarStore = create<SidebarState & SidebarActions>()(
  persist(
    (set) => ({
      isOpen: true,
      toggle: () => set((state) => ({ isOpen: !state.isOpen })),
      setOpen: (open) => set({ isOpen: open }),
    }),
    {
      name: "sidebar_open_state",
      storage: createJSONStorage(() => (typeof window !== "undefined" ? window.localStorage : memoryStorage)),
    }
  )
);
