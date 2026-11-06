const splashStartedAt = typeof performance !== "undefined" ? performance.now() : 0;
const MIN_SPLASH_MS = 520;
let dismissed = false;

/**
 * 移除 index.html 里的内联启动层。
 *
 * 由 App 的首次 useEffect 调用：此时 React 已经完成第一次 commit，启动层
 * 下面已经是真实界面。额外保留一个最短展示时间，避免启动很快时动画只闪一帧。
 */
export function dismissSplash(): void {
  if (dismissed || typeof document === "undefined") return;
  const el = document.getElementById("dtv-splash");
  if (!el) {
    dismissed = true;
    return;
  }
  dismissed = true;

  const elapsed = typeof performance !== "undefined" ? performance.now() - splashStartedAt : 0;
  const wait = Math.max(0, MIN_SPLASH_MS - elapsed);
  window.setTimeout(() => {
    const target = document.getElementById("dtv-splash");
    if (!target) return;
    target.dataset.leaving = "true";
    window.setTimeout(() => target.remove(), 280);
  }, wait);
}
