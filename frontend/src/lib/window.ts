import { useEffect, useState } from "react";
import { Browser, Events, System, Window } from "@wailsio/runtime";

/**
 * 窗口控制。
 *
 * 旧项目在 Navbar 与 MainPlayer 里各写了一套
 * `await import("@tauri-apps/api/window").getCurrentWindow().minimize()`，
 * 且每次都动态 import。这里收敛成一处，并做两件事：
 *  1. 检测是否真的跑在 Wails 里（浏览器预览时 Wails 运行时不可用）
 *  2. 全部 try/catch，窗口操作失败不应该影响 UI
 */

/**
 * 是否真的运行在 Wails 桌面外壳里。
 *
 * 不能只看 `window._wails`：Vite 浏览器预览也会加载 @wailsio/runtime 的 JS
 * 并挂上 `_wails.invoke`。只有原生侧注入的 `_wails.environment` 能区分
 * “有 Go 后端”和“纯浏览器预览”。
 */
export function isWailsRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const runtime = (window as unknown as {
    _wails?: { environment?: { OS?: string } };
  })._wails;
  return Boolean(runtime?.environment);
}

/**
 * 同步判断当前桌面系统。
 *
 * Wails 原生注入的 `_wails.environment.OS` 最准确；拿不到时退回 UA/platform，
 * 这样首帧就能把 macOS 的红绿灯空间和 Windows 自绘按钮区分开，不会先闪一下。
 * 浏览器预览也走 UA 兜底，macOS 上预览同样按 macOS 布局显示。
 */
export function detectDesktopOS(): string | null {
  if (typeof window === "undefined") return null;

  const runtimeOS = (window as unknown as {
    _wails?: { environment?: { OS?: string } };
  })._wails?.environment?.OS;
  if (runtimeOS) return runtimeOS;

  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";
  if (/Macintosh|Mac OS X/i.test(ua) || /^Mac/i.test(platform)) return "darwin";
  if (/Windows/i.test(ua)) return "windows";
  if (/Linux/i.test(ua) && !/Android/i.test(ua)) return "linux";
  return null;
}

export function isMacOS(): boolean {
  return detectDesktopOS() === "darwin";
}

async function safe(fn: () => void | Promise<void>): Promise<void> {
  if (!isWailsRuntime()) return;
  try {
    await fn();
  } catch (err) {
    console.warn("[window] 窗口操作失败：", err);
  }
}

export function minimiseWindow(): Promise<void> {
  return safe(() => Window.Minimise());
}

/**
 * 当前桌面系统（"windows" / "darwin" / "linux"）。
 *
 * 浏览器预览拿不到运行时，返回 null —— 调用方按 Windows 处理即可。
 */
export function useDesktopOS(): string | null {
  const [os, setOS] = useState<string | null>(() => detectDesktopOS());

  useEffect(() => {
    let cancelled = false;
    System.Environment()
      .then((env) => {
        if (!cancelled) setOS(env.OS);
      })
      .catch(() => {
        // 浏览器预览没有原生环境；保留 UA 检测结果，macOS 预览也能正确隐藏按钮。
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return os;
}

/**
 * 双击标题栏（`--wails-draggable: drag` 的拖拽区）最大化 / 还原。
 *
 * Wails v3 只把 macOS 上拖拽区的双击转成原生 `wails:drag:doubleclick`；
 * Windows 的无边框窗口没有系统标题栏，`--wails-draggable` 又只负责拖动，
 * 于是双击标题栏这一下没人接。这里统一补上：
 *  - 目标元素的计算值必须是 drag，按钮 / 输入框等 no-drag 区域不受影响；
 *  - 用 dblclick 而不是第二下 mousedown：等鼠标松开后再切，避免和 Wails
 *    的原生拖动抢同一个按压；
 *  - 窗口全屏时不处理 —— 全屏下没有「最大化」可切。
 */
export function installTitlebarDoubleClick(): () => void {
  if (typeof window === "undefined" || isMacOS()) return () => undefined;

  const onDoubleClick = (event: MouseEvent) => {
    if (event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const draggable = window.getComputedStyle(target).getPropertyValue("--wails-draggable").trim();
    if (draggable !== "drag") return;

    void isWindowFullscreen().then((fullscreen) => {
      if (!fullscreen) void toggleMaximiseWindow();
    });
  };

  window.addEventListener("dblclick", onDoubleClick, true);
  return () => window.removeEventListener("dblclick", onDoubleClick, true);
}
export function toggleMaximiseWindow(): Promise<void> {
  return safe(() => Window.ToggleMaximise());
}

/** 原生窗口全屏（样式全屏），区别于 DOM Fullscreen API。 */
export function toggleWindowFullscreen(): Promise<void> {
  return safe(() => Window.ToggleFullscreen());
}

export async function isWindowFullscreen(): Promise<boolean> {
  if (!isWailsRuntime()) return false;
  try {
    return Boolean(await Window.IsFullscreen());
  } catch {
    return false;
  }
}

export function exitWindowFullscreen(): Promise<void> {
  return safe(() => Window.UnFullscreen());
}

/**
 * 监听原生窗口全屏状态变化。
 *
 * Wails 的窗口全屏不会触发 DOM 的 fullscreenchange，必须在原生事件里同步；
 * 浏览器预览没有运行时，直接返回一个空的取消函数。
 *
 * 注意：Windows 上 Wails 发的是 `windows:WindowFullscreen` /
 * `windows:WindowUnFullscreen`（不是 `common:`），macOS 是
 * `mac:WindowDidEnterFullScreen` 系列；`common:` 在 Linux / 部分版本上使用。
 * 三种都订阅一遍，避免平台相关的事件名对不上导致状态永远不同步。
 */
const WINDOW_FULLSCREEN_EVENTS = [
  "common:WindowFullscreen",
  "common:WindowUnFullscreen",
  "windows:WindowFullscreen",
  "windows:WindowUnFullscreen",
  "linux:WindowFullscreen",
  "linux:WindowUnFullscreen",
  "mac:WindowDidEnterFullScreen",
  "mac:WindowDidExitFullScreen",
] as const;

export function onWindowFullscreenChange(callback: () => void): () => void {
  if (!isWailsRuntime()) return () => undefined;
  const offs: Array<() => void> = [];
  for (const name of WINDOW_FULLSCREEN_EVENTS) {
    try {
      offs.push(Events.On(name, callback));
    } catch {
      /* 某些旧运行时没有对应事件，忽略 */
    }
  }
  return () => {
    for (const off of offs) {
      try {
        off();
      } catch {
        /* 忽略重复取消 */
      }
    }
  };
}

export function closeWindow(): Promise<void> {
  return safe(() => Window.Close());
}

/** 用系统默认浏览器打开链接；浏览器预览时退回 window.open。 */
export function openExternalURL(url: string): void {
  if (!isWailsRuntime()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  try {
    void Promise.resolve(Browser.OpenURL(url)).catch((error) => {
      console.warn("[window] 打开浏览器失败：", error);
    });
  } catch (error) {
    console.warn("[window] 打开浏览器失败：", error);
  }
}

export async function isMaximised(): Promise<boolean> {
  if (!isWailsRuntime()) return false;
  try {
    return Boolean(await Window.IsMaximised());
  } catch {
    return false;
  }
}
