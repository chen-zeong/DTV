import { Window } from "@wailsio/runtime";

/**
 * 窗口控制。
 *
 * 旧项目在 Navbar 与 MainPlayer 里各写了一套
 * `await import("@tauri-apps/api/window").getCurrentWindow().minimize()`，
 * 且每次都动态 import。这里收敛成一处，并做两件事：
 *  1. 检测是否真的跑在 Wails 里（浏览器预览时 Wails 运行时不可用）
 *  2. 全部 try/catch，窗口操作失败不应该影响 UI
 */

export const isWailsRuntime: boolean =
  typeof window !== "undefined" && Boolean((window as unknown as { _wails?: unknown })._wails);

async function safe(fn: () => void | Promise<void>): Promise<void> {
  if (!isWailsRuntime) return;
  try {
    await fn();
  } catch (err) {
    console.warn("[window] 窗口操作失败：", err);
  }
}

export function minimiseWindow(): Promise<void> {
  return safe(() => Window.Minimise());
}

export function toggleMaximiseWindow(): Promise<void> {
  return safe(() => Window.ToggleMaximise());
}

export function closeWindow(): Promise<void> {
  return safe(() => Window.Close());
}

export async function isMaximised(): Promise<boolean> {
  if (!isWailsRuntime) return false;
  try {
    return Boolean(await Window.IsMaximised());
  } catch {
    return false;
  }
}
