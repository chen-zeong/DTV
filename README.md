# DTV（Wails v3 版）

DTV 是一款专注国内直播平台的桌面客户端（斗鱼 / 虎牙 / 抖音 / B站）。
本仓库是把旧 Tauri 2 版（`../DTV-3.0.3`）移植到 **Wails v3** 的全新代码库。

> **当前状态：P2 — 纯前端骨架**
> 只有 UI + 假数据，Go 侧仅负责开窗和提供静态资源，没有任何业务 Service。
> 播放器已接入 xgplayer（用公开测试流验证链路），其余数据全部来自 `src/api/mock`。

## 技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 桌面外壳 | **Wails v3.0.0**（官方稳定版） | 见 `go.mod`，未使用本地 replace |
| 前端构建 | **Vite 8 + TypeScript 5.9** | 替代旧版的 Next.js 16（旧的 RSC/hydration 对桌面端零收益） |
| 路由 | **react-router 7** | 替代 App Router |
| UI | React 19 + **CSS Modules + 设计令牌** | 去掉了 Tailwind 与 HeroUI（旧项目里 Tailwind 工具类实际用了 0 处、HeroUI 只用到 3 个组件） |
| 图标 | lucide-react | |
| 播放器 | xgplayer + xgplayer-flv + xgplayer-hls.js | |
| 弹幕 | 自研 CSS 动画弹幕层 + React 面板 | 替代 danmu.js（旧版适配层里存在"速度/颜色设置不生效"的 bug） |

## 目录结构

```
dtv-wails3/
├── main.go                  # 唯一 Go 入口：开窗 + 静态资源（后续在此注册 Service）
├── go.mod                   # module dtv
├── build/                   # wails3 生成的构建资产（config.yml / Taskfile / 图标 / nsis）
├── docs/
│   ├── PORTING_PLAN.md      # 完整移植方案（决策、映射表、阶段计划、风险）
│   └── ui-preview.png       # 当前 UI 截图（1440×810）
└── frontend/
    ├── bindings/            # wails3 generate bindings 产出（当前 0 个 Service）
    └── src/
        ├── api/             # ★ 唯一数据入口：types.ts + mock/
        ├── components/
        │   ├── shell/       # AppShell / Navbar / PlatformTabs / SearchBox / Sidebar / FollowsList / WindowControls
        │   ├── categories/  # CategoryBar
        │   ├── streamers/   # StreamerCard / StreamerGrid
        │   ├── common/      # SmoothImage
        │   └── ui/          # Spinner / Skeleton
        ├── features/player/ # useXgPlayer / PlayerControls / DanmuOverlay / DanmuPanel
        ├── screens/         # HomeScreen（四平台共用）/ CustomHomePage / PlayerPage
        ├── state/           # Theme / Follow / PlayerUi / CustomCategories
        ├── lib/             # cn / format / storage / window(窗口控制) / appInfo
        ├── styles/          # theme.css（设计令牌）+ base.css（reset）
        └── routes.tsx       # 一张路由表
```

## 开发

前置：Go 1.26+、Node 20+、pnpm、WebView2（Windows 自带），以及 `wails3` CLI。

```bash
# 安装 CLI（官方 v3.0.0）
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0

# 安装前端依赖
cd frontend && pnpm install && cd ..

# 开发（Go 热重载 + Vite HMR，端口 2896）
wails3 dev

# 只跑前端（浏览器预览，无需 Go）
cd frontend && pnpm dev

# 构建
wails3 build            # 产物：bin/dtv.exe
```

## 接后端时要改的地方

1. 在 `internal/services/` 新增 Service struct（方法签名即 IPC 契约）；
2. 在 `main.go` 的 `application.Options.Services` 注册；
3. `wails3 generate bindings -ts -clean`；
4. **只改 `frontend/src/api/index.ts`**：把 `api` 从 `mockApi` 换成调用生成的绑定。
   UI 组件全部只依赖 `DtvApi` 接口，不需要改动。

## 与旧版的差异（有意为之）

- 去掉 Next.js / Tailwind / HeroUI / danmu.js / framer-motion
- 四个平台的首页合并为一份 `HomeScreen`（旧版是 4 份近似复制）
- Navbar 从 815 行拆成 6 个部件；窗口控制逻辑集中到 `lib/window.ts`
- 弹幕面板是真的（旧版的 `DanmuList` 是死组件，全仓没有引用）
- 侧栏折叠是真的（旧版 `isSidebarCollapsed` 没有 setter，是死状态）
- 播放器不再用 7 个 xgplayer 插件 + DOM 后处理，控制条改为普通 React 组件
