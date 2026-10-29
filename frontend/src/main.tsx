import { createRoot } from "react-dom/client";
import "./styles/theme.css";
import "./styles/base.css";
import { App } from "./App";

const container = document.getElementById("root");
if (!container) throw new Error("找不到 #root 挂载点");

// 说明：不使用 React.StrictMode。
// 旧项目在 next.config.mjs 里也显式关掉了（注释写着"StrictMode 会导致 effect
// 重复执行，表现为同一 IPC invoke 多次"）。播放器/弹幕订阅这类命令式副作用
// 在开发期重复执行会真的产生双份资源，这里保持关闭，改为在代码里保证
// effect 可重入（见 useXgPlayer / PlayerPage 的 cancelled 标记）。
createRoot(container).render(<App />);
