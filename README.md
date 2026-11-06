# DTV（Wails v3 版）

DTV 是一款专注国内直播平台的桌面客户端（斗鱼 / 虎牙 / 抖音 / B站）。
本仓库是把旧 Tauri 2 版（`../DTV-3.0.3`）移植到 **Wails v3** 的全新代码库。

> **当前状态：功能移植完成，进入体验优化阶段**
>
> - 四个平台的分区、列表、房间、搜索、取流、弹幕全部走真实后端；
> - 播放器是真实取流（xgplayer + FLV/HLS），弹幕使用 `@ironkinoko/danmaku`；
> - 关注 / 分组 / 订阅 / 局域网同步 / 图片代理 / B 站扫码登录均已可用；
> - 已完成的优化项见 [`docs/IMPROVEMENT_REVIEW.md`](docs/IMPROVEMENT_REVIEW.md)
>   与 [`CHANGELOG.md`](CHANGELOG.md)。

## 技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 桌面外壳 | **Wails v3.0.0** | 见 `go.mod`，未使用本地 replace |
| 前端构建 | **Vite 8 + TypeScript 5.8** | 替代旧版的 Next.js 16 |
| 路由 | **react-router 7（HashRouter）** | 桌面端没有 SPA fallback，hash 路由刷新不会 404 |
| UI | React 19 + **Tailwind v4 + HeroUI v3（局部交互组件） + CSS Modules（Signal 视觉）** | HeroUI 只负责可访问性复杂的控件 |
| 图标 | lucide-react | |
| 播放器 | xgplayer + xgplayer-flv + xgplayer-hls.js | 播放页路由懒加载，独立 chunk |
| 弹幕 | **@ironkinoko/danmaku 2.0.1**（`danmaku` 的高性能分支）+ React 面板 | 滚动走 CSS keyframe 动画（不再每帧 JS 改 transform）；轨道分配/防重叠由库负责，面板是自己实现的（支持跟随、拖宽、新消息提示） |
| 弹幕表情 | `bilicon`（构建期依赖）+ `public/emotes` | B 站 324 / 抖音 222 张官方表情图：命中 `[看]` `[捂脸]` 就还原成表情图，兜底才用 Unicode 表情。由 `frontend/scripts/gen-emotes.mjs` 生成 |
| 签名运行时 | goja（纯 Go，无 cgo） | 斗鱼/抖音签名脚本，带 3 秒超时保护 |
| 本地能力 | net/http + UDP 广播 | 图片代理（Referer/缩放/磁盘缓存）、局域网同步（6 位配对码） |

## 目录结构

```
dtv-wails3/
├── main.go                  # 入口：单实例、窗口记忆、日志、Service 注册
├── go.mod                   # module dtv
├── build/                   # wails3 构建资产（config.yml / Taskfile / 图标 / nsis）
├── internal/
│   ├── appdirs/             # %APPDATA% / %LOCALAPPDATA% 目录布局
│   ├── logging/             # slog 文件日志（按天 + 10MB 轮转）
│   ├── jssign/              # goja 运行时 + CryptoJS + 超时保护
│   ├── services/            # IPC 边界：四个平台 + 图片代理 / LAN 同步 / 配置导入导出
│   └── platforms/           # douyu / huya / douyin / bilibili 的 HTTP/WS 实现
├── docs/
│   ├── ARCHITECTURE.md      # 前端 → IPC → services → platforms 的调用图
│   ├── SHORTCUTS.md         # 播放器快捷键
│   ├── IMPROVEMENT_REVIEW.md
│   ├── PORTING_PLAN.md
│   ├── WINDOWS_SIGNING.md
│   └── ui-preview/          # 旧截图（部分与当前 UI 不一致，见 D-02）
└── frontend/
    ├── bindings/            # wails3 generate bindings 产出
    └── src/
        ├── api/             # 唯一数据入口：types.ts + 平台适配 + 绑定映射
        ├── components/
        │   ├── shell/       # AppShell / Navbar / PlatformTabs / SearchBox / Sidebar / FollowsList
        │   ├── categories/  # CategoryBar（滚动时收成一行）
        │   ├── streamers/   # StreamerCard / StreamerGrid
        │   ├── common/      # SmoothImage / ErrorBoundary
        │   └── ui/          # Spinner / Skeleton / Modal
        ├── features/player/ # useXgPlayer / PlayerControls / DanmuOverlay / DanmuPanel
        ├── features/bilibili/ # 扫码登录
        ├── features/sync/   # 局域网同步弹窗
        ├── screens/         # HomeScreen（四平台共用）/ SubscriptionsPage / PlayerPage
        ├── state/           # Theme / Follow / PlayerUi / Subscription / Toast / BilibiliAuth
        ├── hooks/           # useStreamerFeed（缓存 + 滚动恢复）
        ├── lib/             # cn / format / storage / window / imageProxy / lanSync
        ├── styles/          # theme.css（设计令牌）+ base.css（reset）
        └── routes.tsx       # 一张路由表；PlayerPage 懒加载
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

# 质量门禁
cd frontend && pnpm typecheck && pnpm lint && pnpm test

# 首次使用先初始化自签名证书（只需一次，装进当前用户信任库）
wails3 task windows:sign:setup

# 构建（产物：bin/dtv.exe，Windows 上会自动签名）
wails3 build

# 打包安装包（默认按用户安装，不触发 UAC；需要先装 NSIS：winget install NSIS.NSIS）
wails3 package
```

### 已知的上游构建告警

`wails3 build` 在 Windows 上偶尔会打印 `"uname": executable file not found` 或
`"tail": ...`。这是 Wails v3.0.0 CLI 调用了 Unix 工具，**不影响产物**，可以忽略。

### 弹幕表情资源

`frontend/public/emotes/` 下是 B 站 / 抖音的官方表情图（546 张，约 4.4MB），
由 `frontend/scripts/gen-emotes.mjs` 从 `bilicon`（MIT）生成，生成物已提交到仓库，
运行时不再依赖 `bilicon`：

```bash
# 升级 bilicon 后重新生成 public/emotes + src/lib/emotes.data.ts
cd frontend && pnpm exec node scripts/gen-emotes.mjs
```

表情识别是三级回退（`frontend/src/lib/emoticons.ts`）：
官方表情图 → 平台表情名的 Unicode 表 → `emojibase` CLDR 中文兜底表（约 4400 条），
三级都没命中就保持 `[原文]` 不变。

> 表情美术资源版权归哔哩哔哩 / 抖音所有，这里只用于本地播放器内的弹幕还原。
> 不想携带它们时删掉 `frontend/public/emotes/` 并清空 `src/lib/emotes.data.ts`
> 的映射即可，运行时自动回退到 Unicode 表情。

### 数据目录

| 内容 | 位置 |
| --- | --- |
| 窗口位置/尺寸 | `%APPDATA%\DTV\window.json` |
| 日志 | `%LOCALAPPDATA%\DTV\logs\dtv-YYYYMMDD.log` |
| 图片缓存 | `%LOCALAPPDATA%\DTV\image-cache`（最多 300MB / 7 天） |
| WebView2 数据 | `%LOCALAPPDATA%\DTV\WebView2` |

## 与旧版的差异（有意为之）

- 去掉 Next.js / framer-motion；弹幕改用 `@ironkinoko/danmaku` + React 面板
- 弹幕正文里的 `[看]` `[捂脸]` 这类文字表情还原成**官方表情图**（旧版只画中括号原文）
- 音量条去掉拖动手柄：按住滑条左右滑即可调音量（旧版是 `input[type=range]` 的圆点）
- 四个平台的首页合并为一份 `HomeScreen`（旧版是 4 份近似复制）
- Navbar 从 815 行拆成 6 个部件；窗口控制逻辑集中到 `lib/window.ts`
- 播放页懒加载，`xgplayer` / 弹幕库不再进首屏 chunk
- 首页 feed 有模块级缓存和滚动位置恢复，从直播间返回是瞬时的
- 弹幕按 120ms 批量刷新，面板滚动走 rAF
- 单实例、最小窗口 900×600、窗口位置/尺寸记忆、关闭时落盘
- 图片代理支持 CDN 侧缩放、磁盘 LRU 缓存和每次启动的随机 token
- 局域网同步使用每次开启随机生成的 6 位配对码（不再固定 `dtv`）

## 接后端时要改的地方

1. 在 `internal/services/` 新增 Service struct（方法签名即 IPC 契约）；
2. 在 `main.go` 注册 Service；
3. `wails3 generate bindings -ts -d frontend/bindings .`；
4. 只改 `frontend/src/api/*`：把平台适配层指向生成的绑定。
   UI 组件全部只依赖 `DtvApi` 接口，不需要改动。

## 文档

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/SHORTCUTS.md`](docs/SHORTCUTS.md)
- [`docs/IMPROVEMENT_REVIEW.md`](docs/IMPROVEMENT_REVIEW.md)
- [`docs/PORTING_PLAN.md`](docs/PORTING_PLAN.md)
- [`docs/WINDOWS_SIGNING.md`](docs/WINDOWS_SIGNING.md)
- [`CHANGELOG.md`](CHANGELOG.md)
