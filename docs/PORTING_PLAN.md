# DTV 移植方案（v2 · 决策已定）

> Tauri 2 → Wails v3 移植
> 目标目录：`dtv-wails3/`（新建，不修改 `DTV-3.0.3/` 与 `wails-3.0.0/`）
> 状态：**方案已确认，进入 P0 工具链准备**

---

## 0. 决策清单（已定）

| 决策项 | 决定 | 影响 |
| --- | --- | --- |
| 新目录 | `dtv-wails3/` | 独立目录，旧项目保持原样可运行（作为行为对照） |
| Wails 依赖 | **官方 `github.com/wailsapp/wails/v3 v3.0.0`**，不用本地 `replace` | `v3.0.0` 为官方最新稳定版（发布 2026-10-26）；CLI 同样用 `@v3.0.0` |
| 前端 | **Vite + React + react-router**，替换 Next.js 16 | 去掉 RSC/hydration/静态导出管线 |
| 平台范围 | **Windows 先行**；macOS / Linux 顺延到 P10 | 先交付 Windows 可安装版本 |
| 功能范围 | 斗鱼、虎牙、抖音、B站 **四个平台全都要** | 全功能对齐 |
| B 站登录 | **扫码登录为主**；webview 登录窗作为 Windows 备选入口 | 见 §4.1，备用入口是否实现需最终确认 |

### 与上一版方案的差异

| 项 | v1（上轮） | v2（本轮） |
| --- | --- | --- |
| 前端 | 保留 Next.js（推荐） | **改 Vite + react-router** |
| wails3 | 本地 `replace` 到 `wails-3.0.0/v3` | **官方 v3.0.0 模块 + `@v3.0.0` CLI** |
| 平台 | 未定 | **Windows 优先，四平台功能全保留** |
| B 站登录 | 扫码（待定） | **扫码为主 + webview 窗备选** |
| 工具链 | 待解决 | **P0 阶段先装 Go / 修 pnpm（已给出核实过的命令）** |

---

## 1. 现状盘点

### 1.1 Rust 后端（`DTV-3.0.3/src-tauri`，9,821 行，不含 protobuf 生成码）

| 模块 | 行数 | 职责 | 难度 |
| --- | --- | --- | --- |
| `platforms/huya/stream_url.rs` | 920 | 虎牙 TARS 编码 + 多线路取流 | ★★★★★ |
| `lan_sync.rs` | 531 | HTTP 服务 + mDNS 发现 + token | ★★☆ |
| `platforms/bilibili/stream_url.rs` | 513 | B 站取流 + 触发本地代理 | ★★★ |
| `platforms/douyu/stream_url.rs` | 469 | 斗鱼取流 + **deno_core 跑 JS 签名** | ★★★★ |
| `platforms/huya/danmaku.rs` | 459 | 虎牙 TARS 弹幕 + WS | ★★★★★ |
| `platforms/douyin/danmu/web_fetcher.rs` | 436 | 抖音网页接口 + `a_bogus` | ★★★★ |
| `platforms/douyin/a_bogus.rs` | 412 | `a_bogus` 签名（位运算） | ★★★★ |
| `platforms/bilibili/websocket.rs` | 401 | B 站弹幕分包协议（brotli/zlib） | ★★★★ |
| `proxy.rs` | 337 | actix-web 本地代理 `/live.flv`、`/image` | ★★☆ |
| `platforms/common/http_client.rs` | 299 | reqwest 封装（cookie jar / no_proxy / 重试） | ★ |
| `main.rs` | 264 | 45 个 command 注册 + State 装配 | ★ |
| `douyin/danmu/signature.rs` + `sign.js` | 123 | **deno_core 跑 sign.js** | ★★★ |
| `version_check.rs` / `config_transfer.rs` / `sync_transfer.rs` | 255 | 版本比较、文件对话框导入导出 | ★ |
| 其余平台文件（列表/详情/搜索） | ~2,000 | — | ★~★★★ |

Tauri 依赖点（约 60 处）：45 个 `#[tauri::command]`、12 处 `tauri::State`、5 处 `AppHandle.emit`、1 处 `Window.emit`、1 处 `WebviewWindowBuilder`、2 处 `window.cookies()`（**无 Wails 对等 API**）。

### 1.2 前端（`DTV-3.0.3/web`，89 文件 / 17,108 行）

- Next.js 16 App Router + `output: "export"` + `trailingSlash: true`；React 19、HeroUI、Tailwind 4
- 播放器 `xgplayer` + `xgplayer-flv` + `xgplayer-hls.js` + `xgplayer-transmuxer`；弹幕 `danmu.js`
- 路由 `/`(斗鱼)、`/douyin/`、`/huya/`、`/bilibili/`、`/custom/`、`/player/`

**Next.js 实际使用面（全部）**：`usePathname` ×4、`useRouter` ×3、`useSearchParams` ×1、`next/dynamic({ssr:false})` ×1、`metadata` ×1，共 **10 个调用点 / 6 个文件**。无 `next/link`、`next/image`、`next/font`、Server Component、API Route、middleware。整个 app 都是 `"use client"`。

Tauri 前端依赖点：`invoke()` 约 40 处 / 19 文件、`listen()` 4 文件、`getCurrentWindow()` 2 组件、`WebviewWindow` 1 处、`plugin-os` 1 处、`plugin-opener` 1 处。

---

## 2. 目标架构

```
dtv-wails3/
├── go.mod                   # module dtv ; require github.com/wailsapp/wails/v3 v3.0.0
├── main.go                  # application.New → 建窗 → Service 装配 → Run
├── internal/
│   ├── app/                 # 窗口状态持久化、单实例、日志、退出清理
│   ├── services/            # ★ IPC 边界：8 个 Service，45+ 方法
│   ├── proxy/               # net/http 本地代理 /live.flv /image（Flusher 逐块下发）
│   ├── lansync/             # LAN 同步服务端 + mDNS 广播/发现 + token
│   ├── transfer/            # 配置/同步 JSON 导入导出（配合 app.Dialog）
│   ├── platforms/
│   │   ├── common/          # httpclient、类型、弹幕事件总线
│   │   ├── douyu/  huya/  douyin/  bilibili/
│   ├── jssign/              # goja 运行时，跑 cryptojs.min.js / sign.js
│   └── tars/                # 虎牙 TARS 编解码（自研 ~300 行 + fixture 单测）
├── frontend/                # ★ Vite + React + react-router
│   ├── index.html
│   ├── src/
│   │   ├── main.tsx         # RouterProvider 入口
│   │   ├── routes.tsx       # 路由表（替代 app/*/page.tsx）
│   │   ├── bridge/          # Tauri 兼容垫片（invoke / listen / window / os / opener）
│   │   └── screens|components|platforms|hooks|state|services ...（原样搬入）
│   ├── bindings/            # wails3 generate bindings 产出（勿手改）
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── package.json
├── build/                   # wails3 init 生成：config.yml / Taskfile / icons / nsis ...
├── scripts/                 # 无（Vite 直接 outDir=dist，无需 copy-out）
└── docs/PORTING_PLAN.md
```

**分层**：

```
React 组件（业务代码几乎不改）
  ↓ import { invoke } from "@tauri-apps/api/core"   ← tsconfig paths 重定向
frontend/src/bridge/*（45 条 name → binding 映射）
  ↓
frontend/bindings/dtv/services/*.ts                 ← wails3 generate bindings -ts -clean
  ↓ Call.ByID
Go Service（internal/services）→ 平台层（internal/platforms）
```

Service 只做参数解包 + 调平台层 + 错误转换；业务逻辑全在 `internal/platforms`，可脱离 Wails 用 `go test` 回归。

### 45 个 Tauri command → 8 个 Service

| Service | 方法 |
| --- | --- |
| `DouyuService` | `FetchCategories` `FetchThreeCate` `FetchLiveList` `FetchLiveListForCate3` `FetchRoomInfo` `SearchAnchor` `GetStreamURL` `GetStreamURLWithQuality` `StartDanmaku` `StopDanmaku` |
| `DouyinService` | `GenerateMSToken` `FetchPartitionRooms` `GetLiveStreamURL` `GetLiveStreamURLWithQuality` `FetchRoomInfo` `FetchStreamerInfo` `StartDanmaku` `StopDanmaku` |
| `HuyaService` | `FetchLiveList` `FetchJoinParams` `GetUnifiedStreamURL` `SearchAnchors` `StartDanmaku` `StopDanmaku` |
| `BilibiliService` | `GenerateWbi` `FetchLiveList` `GetLiveStreamURLWithQuality` `FetchStreamerInfo` `GetCookie` `StartQRLogin` `PollQRLogin` `Logout` `SearchRooms` `StartDanmaku` `StopDanmaku` |
| `ProxyService` | `Start` `Stop` `EnsureStatic` |
| `LanSyncService` | `StartServer` `StopServer` `Status` `Token` `Discover` `FetchManifest` `FetchPayload` |
| `TransferService` | `SaveConfigExport` `PickConfigImport` `ExportToDesktop` `PickImport` `ImportLatestFromDesktop` |
| `SystemService` | `OpenInBrowser` `CheckVersion` `SetStreamURL` `GetWindowState` `SaveWindowState` |

事件名保持不变：`danmaku-message`（全局）、`danmaku-<room_id>`（改为全局 `app.Event.Emit`）、`common:WindowClosing`（Wails 内建，替换 `tauri://close-requested`）。

---

## 3. 技术映射

### 3.1 Tauri → Wails v3

| Tauri 2 | Wails v3 |
| --- | --- |
| `tauri::Builder::default()...run(ctx)` | `application.New(application.Options{...})` + `app.Run()` |
| `#[tauri::command]` + `generate_handler!` | 导出方法 + `application.NewService(&Svc{})` |
| `tauri::State<T>` | 构造函数注入 |
| `app_handle.emit(name, p)` | `app.Event.Emit(name, p)` |
| `window.emit(name, p)` | `win.EmitEvent(name, p)` |
| `app.get_webview_window(label)` | `app.Window.GetByName(name)` |
| `WebviewWindowBuilder` | `app.Window.NewWithOptions(WebviewWindowOptions{URL: ...})` |
| `window.cookies()` | **无对等 API** → §4.1 |
| `tauri_plugin_opener` | `app.Browser.OpenURL(url)` |
| `tauri_plugin_window_state` | 自实现 `internal/app/windowstate.go`（~60 行） |
| `window_vibrancy` | `MacWindow{Backdrop: MacBackdropTranslucent}` |
| `titleBarStyle: Overlay` | `MacTitleBarHiddenInset` + `InvisibleTitleBarHeight: 50` |
| `rfd::FileDialog` | `app.Dialog.OpenFileWithOptions(...).PromptForSingleSelection()` / `SaveFileWithOptions(...)` |
| `tauri::async_runtime::spawn` | `go func()` / `errgroup` |
| `panic::set_hook` | `application.Options.PanicHandler` |
| `tauri.conf.json` CSP | `application.Options.Assets.Middleware` 写响应头（默认无 CSP） |
| `tauri.conf.json` bundle | `build/config.yml` + `wails3 task package` |
| `tauri-plugin-os` | `application.System.IsPlatform(...)` / 前端 `System.Environment()` |
| 单实例（未启用） | `application.Options.SingleInstance` |

### 3.2 Rust crate → Go

| Rust | Go |
| --- | --- |
| `reqwest`(+cookie jar, no_proxy, http1_only) | `net/http` + `net/http/cookiejar` + `Transport{Proxy:nil, ForceAttemptHTTP2:false}` |
| `tokio-tungstenite` / `tungstenite` | `github.com/coder/websocket`（wails 已依赖）或 `gorilla/websocket`（wails 也依赖） |
| `serde`/`serde_json` | `encoding/json`（注意 camelCase 字段名对齐） |
| `prost` + `prost-build` | `protoc-gen-go`（`douyin.proto` 已有） |
| `flate2` | `compress/gzip`、`compress/flate` |
| `brotlic` | `github.com/andybalholm/brotli` |
| `tars-stream` | **自研 `internal/tars`** + fixture 单测 |
| `deno_core`（2 处） | `github.com/dop251/goja` |
| `md-5`/`hex`/`base64` | `crypto/md5`/`encoding/hex`/`encoding/base64` |
| `rand` | `math/rand/v2` + `crypto/rand` |
| `actix-web`+`actix-cors` | `net/http` + CORS 中间件（需 `http.Flusher`） |
| `awc` | `net/http` |
| `mdns-sd` | `github.com/hashicorp/mdns` 或 `grandcat/zeroconf` |
| `local-ip-address` | `net.Interfaces()` |
| `url`/`urlencoding`/`percent-encoding`/`serde_urlencoded` | `net/url` + `url.Values` |
| `chrono` | `time` |
| `lazy_static`/`once_cell` | `sync.Once` |
| `html-escape` | `html.EscapeString` |
| `specta` | 删除（Wails 自带绑定生成器） |

### 3.3 前端 API 垫片

```jsonc
// frontend/tsconfig.json
"paths": {
  "@/bridge/*": ["./src/bridge/*"],
  "@tauri-apps/api/core":          ["./src/bridge/tauri-core.ts"],
  "@tauri-apps/api/event":         ["./src/bridge/tauri-event.ts"],
  "@tauri-apps/api/window":        ["./src/bridge/tauri-window.ts"],
  "@tauri-apps/api/webviewWindow": ["./src/bridge/tauri-webviewwindow.ts"],
  "@tauri-apps/plugin-os":         ["./src/bridge/tauri-os.ts"],
  "@tauri-apps/plugin-opener":     ["./src/bridge/tauri-opener.ts"]
}
```

→ 19 个业务文件的 `import` 一行不改。要点：

- `invoke(name, args)`：**对象参数 → 位置参数**解包（`invoke("get_huya_unified_cmd", {roomId, quality, line})` → `Huya.GetUnifiedStreamURL(roomId, quality, line)`）
- `listen(name, cb)`：`Events.On(name, d => cb({payload: d, event: name}))`，保留旧回调读 `event.payload` 的习惯
- `getCurrentWindow()`：`Window.Minimise/Close/ToggleMaximise`
- 拖拽：`data-tauri-drag-region` → `style={{ "--wails-draggable": "drag" }}`（约 10 处，集中在 `Navbar.tsx`）

---

## 4. 关键设计

### 4.1 B 站登录（唯一需要改产品行为的地方）

**主方案：后端扫码登录**（Windows / macOS / Linux 全通用，不依赖 webview）

1. `GET https://passport.bilibili.com/x/passport-login/web/qrcode/generate` → `{url, qrcode_key}`
2. 前端用现有依赖 `qrcode.react` 渲染 `url`
3. 后端按 1.5s 轮询 `.../qrcode/poll?qrcode_key=...`（0=成功，86101=未扫码，86090=已扫未确认，86038=过期）
4. 成功时 `data.url` 的 query 直接带 `SESSDATA` / `bili_jct` / `DedeUserID`，拼成 cookie 串返回前端
5. 前端持久化到 `localStorage['bilibili_cookie']`（与旧逻辑完全一致，`extractRequiredFlags`/`hasRequiredCookies` 不用改）
6. 匿名 bootstrap（`buvid3`/`buvid4`）改走 `https://api.bilibili.com/x/frontend/finger/spi`

成本：Go ~150 行 + 前端二维码弹窗 ~80 行（替换 `useBilibiliCookie.login()`）。

**备选入口：webview 登录窗（Windows）**

- `app.Window.NewWithOptions({URL: "https://passport.bilibili.com/login"})` 打开，`common:WindowClosing` 监听关闭
- 取 Cookie 的两条路：① CDP（`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=...` + `Network.getAllCookies`）；② 读 WebView2 cookie 库 + DPAPI 解密
- 成本 ~250 行，脆弱（端口冲突、版本升级失效），**macOS/Linux 无解**
- 建议：**接口预留，默认不实现**；若你要求保留"网页登录"入口，则只在 Windows 上提供

### 4.2 JS 签名：deno_core → goja

仅 2 处用到 JS：`douyu/stream_url.rs`（`cryptojs.min.js` + `ud98484234()`）、`douyin/danmu/signature.rs`（`sign.js` 的 `get_sign()`）。

- 首选 `github.com/dop251/goja`（纯 Go、无 cgo、可交叉编译），`embed` 原样加载 `sign.js` / `cryptojs.min.js`
- 需要 `window`/`self`/`document`/`navigator` 的最小 shim（Rust 侧已有同类代码可直接照抄）
- 兜底：直接翻译成 Go（`a_bogus.rs` 已是纯 Rust 实现，说明这条路可行）
- **P4 第一天就做 spike**，这是唯一"可能推翻方案"的技术点

### 4.3 本地代理

- `net/http` handler：`io.Copy` + `http.Flusher` 逐块 flush（或 `httputil.ReverseProxy` + `FlushInterval: -1`）
- 保留 CORS、`Range` 透传、`Referer`/`Origin` 头改写
- 端口 0 自动分配 + 进程内单例，前端只拿 base URL
- Windows webview origin 是 `http://wails.localhost`（http，无 mixed-content 问题）；macOS `wails://wails` 自定义 scheme 需在 P10 实测媒体加载

### 4.4 窗口状态记忆（`internal/app/windowstate.go`）

启动读 `os.UserConfigDir()/DTV/window.json` → 用于 `X/Y/Width/Height/StartState`；`WindowClosing` + 移动/缩放防抖写盘。约 60 行。

### 4.5 CSP / 安全模型

Wails 默认不注入 CSP。用 `Assets.Middleware` 给 HTML 响应补等价头：沿用旧 CSP，去掉 `tauri://localhost`，保留 `blob:` / `'unsafe-eval'`（`danmu.js`、transmuxer 可能需要），跑通后再逐步收紧。

### 4.6 Vite 与 assetserver 的两个接口点

| 问题 | 处理 |
| --- | --- |
| **SPA 深链接 404** | `AssetFileServerFS` 只服务真实文件，未知路径直接 404。Next 静态导出靠 `trailingSlash` 生成 `douyin/index.html` 天然可用；改 Vite SPA 后 `/douyin/` 不存在 → 必须加 `Assets.Middleware`：对 `Accept: text/html` 的导航请求，若下游返回 404 则把路径改写为 `/` 再走一次（用记录型 `ResponseWriter` 判断，约 40 行） |
| **dev 跨源** | dev 模式浏览器 origin 是 `http://wails.localhost`，dev server 是 `localhost:2896`。若被拦，配 `vite server.cors: true` / `server.allowedHosts: ["wails.localhost"]`（Next 则必须配 `allowedDevOrigins`，这也是改 Vite 的理由之一） |

Vite 关键配置：

```ts
// frontend/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";      // 替换 @tailwindcss/postcss
import wails from "@wailsio/runtime/plugins/vite"; // ★ Wails 官方插件，处理 bindings 解析

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: Number(process.env.WAILS_VITE_PORT) || 2896, // 与 wails3 dev -port 对齐
    strictPort: true,
  },
  plugins: [react(), tailwindcss(), wails("./bindings")],
  build: { outDir: "dist" },   // 直接产出 Wails 约定的 frontend/dist
});
```

> **`@wailsio/runtime/plugins/vite` 是必留项**：官方 `react` 模板自带（见 `internal/templates/react/frontend/vite.config.ts`），负责把 `./bindings` 解析到生成的 JS 绑定，去掉会导致 dev 下绑定导入失败。
>
> 注意：Vite 产物目录就是 `frontend/dist`，因此 `//go:embed all:frontend/dist` 与 `wails3` 默认 Taskfile 全部不用改（Next 则需要 `out → dist` 拷贝脚本）。

---

## 5. 前端 Next.js → Vite + react-router 迁移细则

### 5.1 逐项映射

| Next.js | Vite + react-router |
| --- | --- |
| `app/page.tsx` + `app/douyin/page.tsx` …（6 个） | `src/routes.tsx` 一张路由表 |
| `app/layout.tsx`（含 `metadata`） | `index.html`（`<title>DTV</title>`）+ `src/App.tsx`（`<Outlet/>`） |
| `usePathname()` ×4 | `useLocation().pathname` |
| `useRouter().push(path)` | `useNavigate()(path)` |
| `useRouter().replace(path)` | `navigate(path, { replace: true })` |
| `useRouter().back()` | `navigate(-1)` |
| `useSearchParams()` ×1 | `useSearchParams()`（react-router-dom，返回 `[sp, setSp]`） |
| `dynamic(..., { ssr: false })` ×1 | `React.lazy` + `<Suspense>` |
| `"use client"` ×30 | 全部删除 |
| `next.config.mjs` / `postcss.config.mjs` | `vite.config.ts`（含 tailwind 插件） |
| `@next/next` eslint 规则 | 删除 |

路由表（保持旧 URL 形状 `/player/?platform=x&roomId=y`）：

```tsx
const routes = [
  { path: "/",            element: <DouyuHomePage /> },
  { path: "/douyin",      element: <DouyinHomePage /> },
  { path: "/huya",        element: <HuyaHomePage /> },
  { path: "/bilibili",    element: <BilibiliHomePage /> },
  { path: "/custom",      element: <CustomHomePage /> },
  { path: "/player",      element: <PlayerPage /> },
]
```

用 `BrowserRouter` + §4.6 的 fallback middleware；URL 里的 `/douyin/` 尾斜杠由 react-router 自动归一，旧代码里的 `pathname === "/douyin/"` 判断需改成不以尾斜杠为条件（`FollowsList`/`Navbar`/`AppShell` 各有 1 处判断，约 4 处微调）。

### 5.2 依赖与脚本调整

```jsonc
// frontend/package.json  —— 版本号以 `wails3 init -t react` 生成的模板为准，勿手写旧版本
"dependencies": {
  "@wailsio/runtime": "3.0.0",                 // 模板用 {{.RuntimeVersion}}，即 3.0.0
  "react": "^19", "react-dom": "^19",
  "react-router-dom": "^7",
  "framer-motion", "@heroui/react", "lucide-react", "uuid",
  "xgplayer", "xgplayer-flv", "xgplayer-hls.js", "xgplayer-transmuxer",
  "danmu.js", "qrcode.react"
},
"devDependencies": {
  "@vitejs/plugin-react": "^6.0.0",   // 模板实测值
  "vite": "^8.2.4",                   // 模板实测值
  "tailwindcss": "^4", "@tailwindcss/vite": "^4",
  "typescript": "^5.8", "@types/react": "^19", "@types/react-dom": "^19"
},
"scripts": {
  "dev": "vite",
  "build": "tsc && vite build --mode production",
  "preview": "vite preview"
}
```

> 模板里是 React 18，我们的项目是 React 19 + HeroUI 3，需要在 init 之后手动升到 19 并验证 HeroUI 兼容性。

删除：`next`、`@tauri-apps/*`、`@tailwindcss/postcss`、`postcss`。

### 5.3 迁移代价

6 个文件 10 个调用点 + 入口 `main.tsx`/`routes.tsx`/`App.tsx` 新建 + 4 处尾斜杠判断修正 → **约 2 人日**（含调试 Tailwind 4 插件、SPA fallback、播放器回归）。

---

## 6. 分阶段计划（Windows 先行）

> 估时假设 1 名熟悉 Go 的开发者；不含外部等待（签名/公证/审核）。

| 阶段 | 内容 | 人日 | 验收 |
| --- | --- | --- | --- |
| **P0 工具链** ✅ | ~~Go 1.26.10、pnpm 执行策略、`wails3` `@v3.0.0`、WebView2 校验~~ **已完成（见 §7.7）** | 0.5 | `wails3 doctor` = SUCCESS |
| **P1 骨架** | `dtv-wails3/`、`go.mod`（`require github.com/wailsapp/wails/v3 v3.0.0`）、`wails3 init -t react-ts`、`build/config.yml`、图标、空窗口 | 1 | `wails3 dev` 与 `wails3 build` 都通过 |
| **P2 前端 Vite 迁移** | Next → Vite + react-router（§5 全部）、bridge 垫片（先 mock）、拖拽改造、SPA fallback 中间件 | 2 | 6 个页面可切换、播放器 UI 正常、标题栏可拖拽 |
| **P3 服务层闭环** | `main.go` 窗口（1440×810 居中 + MacWindow 配置 + BackgroundColour）、`internal/app`（窗口状态/日志/PanicHandler）、先做 `DouyuService.FetchRoomInfo` + `SystemService.OpenInBrowser`、`generate bindings -ts -clean` | 2 | 一条真链路（前端 → 绑定 → Go → 斗鱼 API → 渲染） |
| **P4 基础设施 + 斗鱼** | httpclient（cookie jar/no_proxy/超时/重试）、**goja spike**、斗鱼列表/分类/房间/搜索/取流/弹幕 STT、`internal/proxy` | 4 | 斗鱼从首页到播放（含弹幕）全链路 |
| **P5 虎牙 + 抖音** | `internal/tars` + fixture 单测、虎牙取流/列表/搜索/弹幕、抖音 `a_bogus`、`douyin.proto` 生成、gzip 帧、弹幕 WS、msToken、分区/详情/取流 | 6 | 虎牙/抖音 列表→播放→弹幕 全链路 |
| **P6 B 站 + 扫码登录** | WBI 签名、直播列表、主播信息、搜索、取流（触发代理）、弹幕 WS（brotli 分包/心跳）、**扫码登录 + cookie 持久化**、匿名 bootstrap | 4 | B 站匿名/登录两种状态都能播放 + 弹幕 |
| **P7 外围** | LAN 同步（HTTP 服务 + mDNS + token）、配置导入导出、版本检查、退出清理 | 3 | 两机互通、配置可导出导入 |
| **P8 窗口体验 + 打包** | 自定义标题栏、窗口状态恢复、单实例、CSP 头、nsis（中文）打包、图标/版本信息 | 2 | 安装包可装可跑、窗口位置重启保留 |
| **P9 回归验收** | 4 平台 × 列表/分类/搜索/关注/播放/弹幕/清晰度/线路 逐项对照；打包后回归 | 2–3 | 功能清单全绿 |
| **P10 macOS / Linux** | 毛玻璃、`MacTitleBarHiddenInset`、媒体加载与 `wails://` scheme 实测、dmg / deb / appimage | 3–4 | 双平台可用安装包 |

**Windows 交付：P0–P9 ≈ 24–26 人日**；先交 P0–P4（≈ 9.5 人日）的"斗鱼可播"版本。

---

### 6.1 P1 / P2 执行记录（已完成）

**P1 骨架**

- `git init` 独立仓库（默认分支 `master`），module 名 `dtv`，版本 `4.0.0`
- `wails3 init -t react -n dtv` 生成了完整 `build/`（config.yml / Taskfile / icons / nsis / dmg / deb），随后把子目录内容上提到仓库根
- `build/config.yml`：productName `DTV`、productIdentifier `com.dtv.app`、version `4.0.0`
- `Taskfile.yml`：`PACKAGE_MANAGER` 默认 `pnpm`，`VITE_PORT` 默认 `2896`
- `main.go`：1440×810 居中、`Frameless: true`（与旧版自绘标题栏一致）、暗色首帧背景、macOS 毛玻璃；**未注册任何 Service**

**P2 前端**

| 项 | 结果 |
| --- | --- |
| 依赖 | react 19 / react-router 7 / vite 8 / xgplayer 3 + flv + hls / lucide-react；**删掉** next、tailwind、HeroUI、danmu.js、framer-motion |
| 文件 | 42 个 TS/TSX + 17 个 CSS Module（旧版为 89 文件 / 17,108 行） |
| 路由 | `/`(斗鱼) `/huya` `/douyin` `/bilibili` `/custom` `/player?platform=&roomId=` |
| 数据 | `src/api`（`DtvApi` 接口 + `mock` 实现，延迟 220ms 演练 loading） |
| 验证 | `tsc --noEmit` 零错误；`vite build` 通过；headless Chrome dump-dom 确认侧栏/顶栏/直播卡片/关注均渲染 |
| 构建 | `wails3 build` → `bin/dtv.exe`（12.2 MB）**exit 0**；启动后窗口类 `WailsWebviewWindow`、标题 `DTV`、尺寸 1305×810（屏幕比 1440 窄，Wails 自动收敛） |

**过程中修掉的两个模板坑**

1. `wails3 generate bindings` 在没有 Service 时仍会生成 `github.com/wailsapp/wails/v3/internal/eventcreate`，但**必须先手动跑一次**，否则 `@wailsio/runtime/plugins/vite`（wails-typed-events）在 build 阶段直接报 `Event bindings module not found`。
2. 模板 `build/windows/Taskfile.yml` 的清理步骤 `powershell Remove-item *.syso` 在无匹配文件时返回非 0，导致 `wails3 build` 整体 exit 1 —— 已改为 `Remove-Item -ErrorAction SilentlyContinue`。

**相对旧版有意的改进**（对应 §1.2 与外壳/播放器规格里的"代码异味"）

- 四平台首页合并为一份 `HomeScreen`（旧版 4 份近似复制）
- Navbar 815 行 → 拆成 PlatformTabs / SearchBox / WindowControls / 主播岛
- 窗口控制集中到 `lib/window.ts`（旧版 Navbar 与 MainPlayer 各写一套 Tauri 动态 import）
- 路由判断集中到 `routes.tsx` + `platformFromPath()`（旧版在 4 个组件里各自硬编码尾斜杠比较）
- 弹幕面板是真的（旧版 `DanmuList` 全仓未被引用）
- 侧栏折叠是真的（旧版 `isSidebarCollapsed` 没有 setter）
- 播放器控制条改为普通 React 组件，去掉 7 个 xgplayer 插件 + `controlLayout.ts` 的 DOM 后处理
- localStorage 统一走 `lib/storage.ts`（键名集中在 `STORAGE_KEYS`）

---

## 7. 环境准备（P0，已核实）

### 7.1 现状核查结果

| 项 | 状态 | 证据 |
| --- | --- | --- |
| WebView2 Runtime | ✅ **已装** `156.0.4314.50` | `wails3 doctor` 已确认 |
| Node.js | ✅ `v24.17.0` | |
| npm | ✅ `11.13.0` | `wails3 doctor` 已确认 |
| Git | ✅ `C:\Program Files\Git\cmd\git.exe` | |
| winget | ✅ 可用 | Go 用 zip 方案免 UAC |
| `tar` / `curl` | ✅ 系统自带 | |
| **Go** | ✅ **已装 `go1.26.10 windows/amd64`** | `C:\Users\chen\Local\go\1.26.10\go`，已入 User PATH |
| **pnpm** | ✅ **已修好 `11.8.0`** | `CurrentUser` 策略设 `RemoteSigned` |
| **wails3 CLI** | ✅ **已装 `v3.0.0`** | `C:\Users\chen\go\bin\wails3.exe`（53.5 MB） |
| `task` 独立二进制 | ➖ **不需要** | v3.0.0 直接依赖 `github.com/wailsapp/task/v3 v3.40.1-patched3`，`wails3 task` 用内嵌运行时 |
| NSIS | ❌ 未安装 | **P8 打包前需要**（`wails3 doctor` 已报 Not Installed） |
| MSIX Packaging Tool / SignTool | ❌ 未安装 | 仅做 MSIX 或代码签名时才需要，MSI 走 wix 需要 Windows SDK |

### 7.2 Go 版本选择

`github.com/wailsapp/wails/v3@v3.0.0` 的 `go.mod`：

```
go 1.26.0
toolchain go1.26.10
```

→ 安装 **go1.26.10**（与 `toolchain` 指令完全一致，避免 Go 再去下载切换工具链）。虽然当前最新稳定版是 1.27.3，但用 1.26.10 是零摩擦选择。

### 7.3 安装 Go（免 UAC 的 zip 方案）

```powershell
$ProgressPreference = 'SilentlyContinue'
$dest = "C:\Users\chen\Local\go\1.26.10"          # 解压后实际 GOROOT = $dest\go
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Invoke-WebRequest "https://go.dev/dl/go1.26.10.windows-amd64.zip" -OutFile "$env:TEMP\go1.26.10.zip"
Expand-Archive "$env:TEMP\go1.26.10.zip" -DestinationPath $dest -Force
# User PATH 追加（不碰 Machine PATH）
$old = [Environment]::GetEnvironmentVariable("Path","User")
[Environment]::SetEnvironmentVariable("Path", "$dest\go\bin;C:\Users\chen\go\bin;$old", "User")
```

验证（新终端）：

```powershell
go version    # go version go1.26.10 windows/amd64
go env GOPATH # C:\Users\chen\go
```

### 7.4 修 pnpm 执行策略

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

验证：

```powershell
pnpm --version
```

> 备选（完全不改策略）：调用时写 `pnpm.cmd` 而非 `pnpm`。但 `build/Taskfile.yml`、编辑器终端、你自己手敲都会遇到同样问题，所以建议直接设 `RemoteSigned`（微软推荐值，仅影响 CurrentUser）。

### 7.5 安装 wails3 CLI（官方 v3.0.0）

```powershell
# ★ 必须先配 GOPROXY：本机直连 proxy.golang.org（Google IP）不通
go env -w GOPROXY=https://goproxy.cn,https://goproxy.io,direct
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0
wails3 version        # v3.0.0
wails3 doctor         # Windows 依赖体检
```

> **网络坑（已实测踩到）**：本机 WinINET 配了 `127.0.0.1:7890` 代理，PowerShell 的 `Invoke-WebRequest` 会用它，但 **Go / Node 都不读 WinINET**。`go install` 首跑即报 `dial tcp 142.250.73.81:443 ... 无响应`。改用 `goproxy.cn` 镜像后 338 秒安装成功（下载了约 130 个模块，含 `wailsapp/task/v3`、`charmbracelet` 全家桶、`goreleaser/nfpm`）。
>
> 注意：**不安装独立 `task`**（v3.0.0 已内嵌）；`wails3 task` 直接可用。

### 7.6 项目初始化（P1）

```powershell
cd C:\Users\chen\Desktop\code\dtv_go\dtv-wails3
go mod init dtv
go get github.com/wailsapp/wails/v3@v3.0.0
wails3 init -t react -n dtv           # ★ 模板名用 `react`（v3.0.0 起 TypeScript 占裸名，JS 才是 `react-js`）
```

### 7.7 P0 执行记录（已完成）

| 步骤 | 结果 |
| --- | --- |
| Go 1.26.10 zip 下载 | 71.5 MB / 9 秒；解压 193 秒 → `C:\Users\chen\Local\go\1.26.10\go` |
| User PATH | 已在最前面追加 `...\go\bin` 与 `C:\Users\chen\go\bin`（**未改动 Machine PATH**） |
| pnpm 执行策略 | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` → `pnpm --version` = `11.8.0` |
| GOPROXY | `go env -w GOPROXY=https://goproxy.cn,https://goproxy.io,direct`（持久化到 go env） |
| wails3 CLI | `go install ...@v3.0.0` 成功，338 秒 → `C:\Users\chen\go\bin\wails3.exe`（53.5 MB） |
| `wails3 version` | `v3.0.0` |
| `wails3 doctor` | **SUCCESS / Your system is ready for Wails development!**（唯一缺口：NSIS 未装，P8 前补） |

> ⚠️ **必须重开终端**：新 PATH 写入的是用户环境变量，已打开的终端/编辑器进程不会自动生效。验证：新开 PowerShell 直接敲 `go version`、`wails3 version`。
>
> 另注：本机 GPU 显示为 `OrayIddDriver`（向日葵虚拟显卡），`CGO_ENABLED=0`。若后续 WebView2 播放出现异常，先排查是否被虚拟显卡/远程桌面影响（非 Wails 问题）。

---

## 8. 验证与回归

- **单元层**：`internal/platforms/**` 可脱离 Wails 测试；每平台"固定输入 → 固定输出"（fixture 从旧项目真实响应抓取）
- **协议层**：`internal/tars`、`douyin.proto` 解码、B 站分包、`a_bogus` 用**向量表**锁死（给定 query+UA 必须产出与 Rust 版一致结果）
- **对照层**：`cmd/dtvprobe` 命令行直接打印各接口 JSON，**新旧两个 app 同一 room_id 逐字段 diff**（保留旧项目的主要理由）
- **静态检查**：`go vet ./...`、`golangci-lint`、`go test -race ./...`
- **打包回归**：`wails3 build` 产物必须实装实测（dev 模式的 dev-server 分流会掩盖 assetserver 问题）

---

## 9. 风险登记

| # | 风险 | 影响 | 概率 | 应对 |
| --- | --- | --- | --- | --- |
| R1 | goja 跑不通 `cryptojs.min.js` / `sign.js` | 中（斗鱼/抖音不可用） | 中 | P4 首日 spike；兜底改 Go 实现 |
| R2 | 虎牙 TARS 移植出错 | 中 | 中 | fixture 双向校验；先"能解"再"能编" |
| R3 | 抖音 `a_bogus` 与 Rust 版不一致 | 中 | 中 | 向量表测试锁死 |
| R4 | WebView2 播放 FLV/HLS 失败（MSE/CORS/Range） | 高 | 低 | P2 就用真实流验证播放器 |
| R5 | Vite SPA 深链接 404 | 中 | 高 | §4.6 fallback 中间件（必须做） |
| R6 | 尾斜杠路由判断失效（4 处） | 低 | 高 | P2 逐处修正 + 手测 |
| R7 | B 站扫码接口变动/风控 | 高 | 低 | 保留 webview 登录窗备选（§4.1） |
| R8 | 打包后 CSP / 资源 404 | 中 | 中 | P8 必须实测安装包 |
| R9 | 45 个方法参数顺序错位（对象→位置） | 中 | 高 | 垫片集中在 1 文件 + `tsc` 强类型 |
| R10 | ~~Go 1.26.10 与本机其他 Go 工具冲突~~ | — | — | **已消除**：独立目录 `C:\Users\chen\Local\go\1.26.10` + 仅改 User PATH |
| R11 | NSIS / Windows SDK 未装 | 低 | 确定 | P8 前 `winget install NSIS.NSIS`；MSI 方案另需 Windows SDK |
| R12 | 网络：Go 直连 Google 不通、npm 正常 | 中 | 已发生 | `GOPROXY=goproxy.cn` 已持久化（§7.5） |

---

## 10. 遗留待确认

1. **B 站 webview 登录窗备选入口**：本轮按"**扫码为主 + 备选接口预留、默认不实现**"写。若你要"两个入口都给"，请在 P6 前确认（会多约 1 人日且仅 Windows 可用）。
2. `module` 名用 `dtv`（推荐，bindings 路径 `frontend/bindings/dtv/services/...`）还是 `github.com/c-zeong/dtv`？
3. 新目录是否建独立 git 仓库（还是并入当前 `dtv_go` 工作区）？
4. 版本号从 `3.0.3` 起还是直接 `4.0.0`（影响 `build/config.yml` 与 `version_check` 远端比较逻辑）？
