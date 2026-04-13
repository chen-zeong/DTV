"use client";

import React, { useMemo } from "react";

import { useBilibiliCookie } from "@/platforms/bilibili/useBilibiliCookie";

export type BilibiliCookieControlsVariant = "player" | "category";

type Props = {
  variant?: BilibiliCookieControlsVariant;
  onCookieChanged?: (cookie: string | null) => void;
};

export function BilibiliCookieControls(props: Props) {
  const { variant = "player", onCookieChanged } = props;
  const { hasRequired, isLoggingIn, error, login, logout } = useBilibiliCookie({
    autoBootstrap: true,
    onChanged: onCookieChanged
  });

  const loginTitle = hasRequired ? "点击重新登录" : "登录以同步 Cookie";
  const loginLabel = useMemo(() => {
    if (isLoggingIn) return "登录中...";
    if (hasRequired) return "已登录";
    return "登录";
  }, [hasRequired, isLoggingIn]);

  if (variant === "category") {
    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <button type="button" className="category-subscribe-btn" onClick={() => void login()} disabled={isLoggingIn} title={loginTitle}>
          {loginLabel}
        </button>
        {hasRequired && !isLoggingIn ? (
          <button type="button" className="category-subscribe-btn" onClick={() => void logout()} title="退出登录">
            退出
          </button>
        ) : null}
        {error ? (
          <span className="cookie-error" title={error}>
            {error}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <span className="cookie-status">
      <button type="button" className="cookie-status-btn" onClick={() => void login()} disabled={isLoggingIn} title={loginTitle}>
        <span className={hasRequired && !isLoggingIn ? "cookie-configured" : "cookie-unset"}>{loginLabel}</span>
      </button>
      {hasRequired && !isLoggingIn ? (
        <button type="button" className="cookie-clear-btn" onClick={() => void logout()} title="退出登录">
          退出
        </button>
      ) : null}
      {error ? <span className="cookie-error">{error}</span> : null}
    </span>
  );
}

