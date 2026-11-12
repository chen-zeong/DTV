import { createRoot } from "react-dom/client";
import { SharedElementTransition } from "react-aria-components";
import "./styles/tailwind.css";
import "./styles/theme.css";
import "./styles/base.css";
import { App } from "./App";
import { ensureImageProxy } from "./lib/imageProxy";
import { applyStartupLanding } from "./lib/navigation";
import { dismissSplash } from "./lib/splash";
import { migrateStorageKeys } from "./lib/storage";
import { detectDesktopOS, installTitlebarDoubleClick, isWailsRuntime } from "./lib/window";

const container = document.getElementById("root");
if (!container) throw new Error("找不到 #root 挂载点");
const root = createRoot(container);

// 4.0 早期键名 -> 老版键名迁移，必须先于任何 Provider 读取。
migrateStorageKeys();

// macOS 红绿灯由系统绘制，侧栏需要额外下移；在首帧前把平台写到根节点，
// 避免侧栏先按 Windows 布局画一帧再跳。
const desktopOS = detectDesktopOS();
if (desktopOS) {
  document.documentElement.dataset.os = desktopOS;
}

// 启动落地页：有订阅分区先进「订阅」，没有则保持斗鱼首页 `/`。
// 必须在 HashRouter 挂载前改 hash，避免先渲染一帧斗鱼首页再跳转。
applyStartupLanding();
// 双击标题栏最大化 / 还原。Wails v3 在 Windows 上不接管拖拽区的双击，
// 由这里统一补一条（见 lib/window.ts 的 installTitlebarDoubleClick）。
installTitlebarDoubleClick();

// P-02：图片代理不再阻塞首屏。
// 代理启动需要一次 IPC + 一次本地 net.Listen；失败时 SmoothImage 会回退直连，
// 所以先渲染、后台启动即可。浏览器预览没有 Go 侧，直接跳过。
if (isWailsRuntime()) {
  void ensureImageProxy().catch((error) => {
    console.warn("[image-proxy] 启动失败，将直接加载远端图片", error);
  });
}

// 说明：不使用 React.StrictMode。
// 旧项目在 next.config.mjs 里也显式关掉了（注释写着"StrictMode 会导致 effect
// 重复执行，表现为同一 IPC invoke 多次"）。播放器/弹幕订阅这类命令式副作用
// 在开发期重复执行会真的产生双份资源，这里保持关闭，改为在代码里保证
// effect 可重入（见 useXgPlayer / PlayerPage 的 cancelled 标记）。
root.render(
  // HeroUI v3 的 Tabs.Indicator 使用 react-aria 的 SharedElement，
  // 需要在根部提供 SharedElementTransition 作用域。
  <SharedElementTransition>
    <App />
  </SharedElementTransition>,
);

// 兜底：即使 React 在挂载阶段抛错，也不要把启动层永久盖在错误页上。
window.setTimeout(dismissSplash, 2000);
