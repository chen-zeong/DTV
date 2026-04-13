"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

let sharedProxyBase = "";
let sharedEnsurePromise: Promise<string> | null = null;
const sharedSubscribers = new Set<() => void>();

function getSharedProxyBase() {
  return sharedProxyBase;
}

function setSharedProxyBase(nextBase: string) {
  const normalized = (nextBase || "").trim();
  if (normalized === sharedProxyBase) return;
  sharedProxyBase = normalized;
  for (const fn of sharedSubscribers) {
    try {
      fn();
    } catch {
      // ignore subscriber errors
    }
  }
}

function subscribeSharedProxyBase(fn: () => void) {
  sharedSubscribers.add(fn);
  return () => {
    sharedSubscribers.delete(fn);
  };
}

export function useImageProxy() {
  const proxyBaseRef = useRef(getSharedProxyBase());
  const [proxyBaseState, setProxyBaseState] = useState(getSharedProxyBase());

  useEffect(() => {
    return subscribeSharedProxyBase(() => {
      const latest = getSharedProxyBase();
      proxyBaseRef.current = latest;
      setProxyBaseState(latest);
    });
  }, []);

  const ensureProxyStarted = useCallback(async () => {
    try {
      if (getSharedProxyBase()) return;
      if (!sharedEnsurePromise) {
        sharedEnsurePromise = invoke<string>("start_static_proxy_server")
          .then((base) => {
            setSharedProxyBase(base || "");
            return getSharedProxyBase();
          })
          .catch((e) => {
            sharedEnsurePromise = null;
            throw e;
          });
      }
      await sharedEnsurePromise;
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
    const baseRaw = proxyBaseRef.current;
    if (!baseRaw) return trimmed;
    const base = baseRaw.endsWith("/") ? baseRaw.slice(0, -1) : baseRaw;
    return `${base}/image?url=${encodeURIComponent(trimmed)}`;
  }, []);

  const proxyReady = useMemo(() => !!proxyBaseState, [proxyBaseState]);

  const getAvatarSrc = useCallback(
    (platform: string, avatarUrl?: string | null) => {
      const u = avatarUrl || "";
      if (!u) return "";
      const p = String(platform || "").toUpperCase();
      if (p === "BILIBILI" || p === "HUYA") {
        // Avoid switching src from direct url -> proxied url (causes flicker on re-renders).
        // For these platforms, only render avatar once proxy is ready.
        if (!proxyReady) return "";
        return proxify(u);
      }
      return u;
    },
    [proxify, proxyReady]
  );

  return { ensureProxyStarted, proxify, getAvatarSrc, proxyBaseRef, proxyReady };
}
