import type { InvokeArgs } from "@tauri-apps/api/core";

export const isTauriEnv = () => true;

export async function tauriInvoke<T>(cmd: string, args?: InvokeArgs): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function openLink(url: string) {
  // 优先使用浏览器行为，避免权限限制
  if (typeof window !== "undefined" && typeof window.open === "function") {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  try {
    const mod = await import("@tauri-apps/plugin-opener");
    const openFn = (mod as { open?: (u: string) => Promise<void>; default?: (u: string) => Promise<void> }).open || mod.default;
    if (typeof openFn === "function") {
      await openFn(url);
      return;
    }
  } catch {
    /* ignore and fallback */
  }

  try {
    const { Command } = await import("@tauri-apps/plugin-shell");
    const platform = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const isWin = platform.includes("Windows") || platform.includes("Win32");
    const isMac = platform.includes("Mac");
    const cmd = isWin ? "cmd" : isMac ? "open" : "xdg-open";
    const args = isWin ? ["/C", "start", url] : [url];
    await Command.create(cmd, args).execute();
    return;
  } catch {
    /* ignore */
  }

  try {
    await tauriInvoke("open_url_cmd", { url });
    return;
  } catch {
    /* ignore */
  }

  if (typeof window !== "undefined" && typeof window.open === "function") {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  if (typeof window !== "undefined") {
    window.location.href = url;
  }
}

export async function setTauriTheme(theme: "light" | "dark") {
  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const win = WebviewWindow.getCurrent();
    await win.setTheme(theme);
  } catch (error) {
    console.warn("[tauri] setTheme failed", error);
  }
}
