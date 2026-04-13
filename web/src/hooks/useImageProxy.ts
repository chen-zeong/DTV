"use client";

import { useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

export function useImageProxy() {
  const proxyBaseRef = useRef("");

  const ensureProxyStarted = useCallback(async () => {
    try {
      if (!proxyBaseRef.current) {
        const base = await invoke<string>("start_static_proxy_server");
        proxyBaseRef.current = base || "";
      }
    } catch (e) {
      console.warn("[useImageProxy] ensureProxyStarted failed:", e);
    }
  }, []);

  const proxify = useCallback((url: string | null | undefined) => {
    const trimmed = (url || "").trim();
    if (!trimmed) return "";
    try {
      const parsed = new URL(trimmed);
      if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") {
        return trimmed;
      }
    } catch {
      // ignore invalid url
    }
    if (!proxyBaseRef.current) return trimmed;
    const base = proxyBaseRef.current.endsWith("/") ? proxyBaseRef.current.slice(0, -1) : proxyBaseRef.current;
    return `${base}/image?url=${encodeURIComponent(trimmed)}`;
  }, []);

  const getAvatarSrc = useCallback(
    (platform: string, avatarUrl?: string | null) => {
      const u = avatarUrl || "";
      if (!u) return "";
      const p = String(platform || "").toUpperCase();
      if (p === "BILIBILI" || p === "HUYA") return proxify(u);
      return u;
    },
    [proxify]
  );

  return { ensureProxyStarted, proxify, getAvatarSrc, proxyBaseRef };
}
