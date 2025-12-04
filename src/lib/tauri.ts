import type { InvokeArgs } from "@tauri-apps/api/core";

export const isTauriEnv = () => true;

export async function tauriInvoke<T>(cmd: string, args?: InvokeArgs): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function openLink(url: string) {
  try {
    const { open } = await import("@tauri-apps/plugin-opener");
    await open(url);
  } catch (error) {
    console.warn("[tauri] opener plugin not available, fallback to window.open", error);
    if (typeof window !== "undefined") window.open(url, "_blank", "noopener,noreferrer");
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
