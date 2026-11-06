import { useEffect, useState } from "react";

/**
 * 弹层的挂载点。
 *
 * 原生全屏（Fullscreen API）下浏览器只渲染全屏元素及其子树，
 * 挂在 `document.body` 上的弹层会直接看不见（弹幕设置 / 弹幕屏蔽都会踩到）。
 * 所以全屏时改挂到全屏元素内部，退出全屏再回到 body。
 */
export function usePortalHost(): HTMLElement {
  const [host, setHost] = useState<HTMLElement>(() => document.body);

  useEffect(() => {
    const sync = () => {
      const fullscreen = document.fullscreenElement;
      setHost(fullscreen instanceof HTMLElement ? fullscreen : document.body);
    };
    document.addEventListener("fullscreenchange", sync);
    sync();
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  return host;
}
