# DTV 项目性能审计与优化建议

> 审计日期：2026-04-21  
> 目标：找出“冗余请求 / 不必要的资源加载 / 可能导致卡顿或高 CPU 的实现”，并给出可落地的优化方向与**预期收益等级**（大幅/中等/小幅/几乎无）。

---

## 结论摘要（优先级从高到低）

| 优先级 | 问题点 | 主要影响 | 预期收益 |
|---:|---|---|---|
| P0 | **播放器相关依赖（`xgplayer` 等）被主界面提前打进首屏 JS** | 启动变慢、首屏加载更重、内存占用偏高 | **大幅提高**（显著减少首屏 JS 体积/解析执行成本） |
| P0 | **弹幕/协议层大量 `println!/console.log` 在高频路径** | 高 CPU、卡顿、日志 IO 抢占（弹幕越多越明显） | **大幅提高**（降低 CPU 与 IO） |
| P0 | **图片代理接口 `Cache-Control: no-store`**（导致封面/头像无法缓存） | 列表滚动/返回页面重复拉图，冗余请求明显 | **大幅提高**（减少图片重复下载/解码） |
| P1 | **B 站 WBI key 每次请求都重新获取**（关注刷新/信息获取会放大） | 每个房间信息请求额外多 1 次网络请求 | **中等提高**（关注列表多时很明显） |
| P1 | **关注列表刷新时频繁写 `localStorage`**（每次 patch 都触发持久化） | 主线程抖动/卡顿，尤其关注数量大时 | **中等提高** |
| P2 | **部分 Rust 模块反复构建 `reqwest::Client` 或使用 blocking client** | 连接池无法复用、阻塞线程、额外握手 | **小幅~中等提高**（视调用频率） |
| P3 | 清理开发期日志/未使用配置（如根目录 `vite.config.ts` 与 Next 并存） | 主要是维护成本与排查干扰 | **几乎无**（运行时） |

---

## 1) 前端（Next/React）性能问题与建议

### 1.1 播放器模块被“提前加载”到首屏（高优先级）

**现象/证据**
- 播放器 Overlay 在应用壳层常驻，且静态 import 了播放器页面：`web/src/state/playerOverlay/PlayerOverlayProvider.tsx:7` 直接 `import { PlayerPage } ...`
- `PlayerPage` 静态 import `MainPlayer`，而 `MainPlayer` 顶部静态 import 了 `xgplayer` 与其 CSS：`web/src/components/player/MainPlayer.tsx:9`、`web/src/components/player/MainPlayer.tsx:11`
- 这会让“即便用户不打开播放器”，首屏也需要加载/解析播放器相关 chunk（可从 `web/out/index.html` 看到首屏加载了包含 `xgplayer` 的 chunk）。

**优化建议**
- 将播放器页面改为**按需动态加载**（只在 `isOpen` 时加载）：
  - 方案 A（推荐）：在 `PlayerOverlayProvider` 内对 `PlayerPage` 使用 `next/dynamic`（`ssr:false`）或 `React.lazy + Suspense`
  - 方案 B：将 `MainPlayer` 动态 import（播放器页仍可静态 import）

**预期收益：大幅提高**
- 首屏 JS 体积/解析执行明显下降，启动更快、内存占用更低（尤其对 WebView2/低配机更明显）。

---

### 1.2 关注刷新导致频繁 `localStorage` 写入（中高优先级）

**现象/证据**
- `FollowProvider` 在 `followedStreamers/folders/listOrder` 变化时立即写入 `localStorage`：`web/src/state/follow/FollowProvider.tsx:194`、`web/src/state/follow/FollowProvider.tsx:199`、`web/src/state/follow/FollowProvider.tsx:204`
- `FollowsList` 刷新会对每个 streamer 逐个 patch（并发 2）：`web/src/components/follows/FollowsList.tsx:32`（`refreshOne`）  
  这会造成短时间内大量 state 更新 + 多次 `localStorage.setItem`（同步 API，容易造成主线程抖动）。

**优化建议**
- 对持久化写入做**节流/批量提交**：
  - 例如在 Provider 内把 `saveJson` 改为 debounce（`setTimeout`/`requestIdleCallback`），或合并为一次写入一个“总对象”
  - 刷新期间把 patch 累积到内存，刷新完成后再一次性落盘

**预期收益：中等提高**
- 关注数多时（几十/上百）刷新更顺滑，减少卡顿。

---

### 1.3 前端存在生产环境日志（低~中优先级）

**现象/证据**
- `console.log` 出现在播放链路：`web/src/platforms/huya/playerHelper.ts:23`、`web/src/platforms/huya/playerHelper.ts:26`
- `useDouyinLiveRooms` 中有 `console.info`：`web/src/hooks/liveRooms/useDouyinLiveRooms.ts:67`

**优化建议**
- 用 `process.env.NODE_ENV !== "production"` 包裹，或统一封装 logger 并在 release 默认关闭 debug

**预期收益：小幅提高**
- 对性能影响通常不如 P0 项明显，但能减少日志 IO 与排查噪音。

---

## 2) 后端（Tauri/Rust）性能问题与建议

### 2.1 图片代理禁用缓存导致重复请求（高优先级）

**现象/证据**
- 图片代理响应强制 `Cache-Control: no-store`：`src-tauri/src/proxy.rs:79`  
  列表封面/头像走本地代理后，浏览器缓存被禁用，返回/滚动时会出现重复拉图（请求与解码成本都高）。

**优化建议**
- 允许缓存（至少短 TTL），例如：
  - `Cache-Control: public, max-age=86400, immutable`（或更保守的 `max-age=3600`）
  - 可选：透传上游 `ETag/Last-Modified`，支持 304
  - 可选：做一个简单的内存 LRU（URL->bytes）避免短时间反复拉取

**预期收益：大幅提高**
- 明显减少图片重复下载/解码，列表滚动/切换页面更流畅，且降低触发平台风控的概率。

---

### 2.2 B 站 WBI key 获取存在“额外请求”且未缓存（中高优先级）

**现象/证据**
- `fetch_bilibili_streamer_info` 每次都会调用 `get_wbi_keys()`，并向 `https://api.bilibili.com/x/web-interface/nav` 发请求：`src-tauri/src/platforms/bilibili/streamer_info.rs:28`~`src-tauri/src/platforms/bilibili/streamer_info.rs:38`
- 在关注列表刷新场景，这会被放大成：**每个房间一次“多余的 WBI key 请求”**。

**优化建议**
- 将 WBI keys 缓存到 `tauri::State`（按时间 TTL，比如 12h 或 1h）：
  - key 很少变化，缓存命中率高
  - 失败时再回源刷新（避免缓存击穿可加互斥/单飞）

**预期收益：中等提高**
- B 站相关请求数大幅减少（理论上减少约 50% 的“房间信息”请求开销：从 2 次/房间 -> 1 次/房间）。

---

### 2.3 弹幕链路存在高频 `println!`（高优先级）

**现象/证据**
- 虎牙弹幕在连接/心跳/解析聊天时同时 `println!` + `info!`：`src-tauri/src/platforms/huya/danmaku.rs:165`、`src-tauri/src/platforms/huya/danmaku.rs:176`、`src-tauri/src/platforms/huya/danmaku.rs:206`
- 抖音签名等也有大量 `println!`：`src-tauri/src/platforms/douyin/danmu/signature.rs:55`、`src-tauri/src/platforms/douyin/danmu/signature.rs:62`

**优化建议**
- 将高频路径日志改为：
  - 仅 `debug_assertions` 下输出，或
  - 统一用 `log` crate 的 `debug!` 并在 release 默认不启用 debug level
- 避免同一事件同时打印两遍（`println!` + `info!` 二选一）

**预期收益：大幅提高**
- 弹幕量大时 CPU 与 IO 压力会显著下降，卡顿减少。

---

### 2.4 B 站弹幕读取使用“固定 sleep 轮询”（中优先级）

**现象/证据**
- Bilibili danmaku 读取循环每 50ms `sleep`：`src-tauri/src/platforms/bilibili/danmaku.rs:86`
- 这属于轮询式“忙等”，弹幕少时也会持续唤醒线程。

**优化建议**
- 如果底层 websocket/读取 API 支持阻塞等待或超时等待，优先使用“阻塞 read + 超时”，或将 sleep 改为事件驱动（例如阻塞 read / channel）

**预期收益：小幅~中等提高**
- 主要减少空闲 CPU 唤醒与耗电，对低配设备更友好。

---

### 2.5 部分 B 站鉴权逻辑使用 `reqwest::blocking::Client` 且每次新建 client（中优先级）

**现象/证据**
- `src-tauri/src/platforms/bilibili/auth.rs:87`、`src-tauri/src/platforms/bilibili/auth.rs:119`、`src-tauri/src/platforms/bilibili/auth.rs:150` 多处创建 `reqwest::blocking::Client`
- blocking client 可能占用线程；反复创建也无法复用连接池/缓存。

**优化建议**
- 优先改为复用 `tauri::State<'_, reqwest::Client>` 或项目自带的 `HttpClient`（`src-tauri/src/platforms/common/http_client.rs`）
- 若必须 blocking（不推荐）：至少把 client 做成全局单例/缓存（`once_cell`）

**预期收益：小幅~中等提高**
- 视调用频率而定；对“偶发登录”帮助不大，但对“频繁初始化/重连”会更明显。

---

## 3) “冗余请求/风控风险”专项（结合项目场景）

### 3.1 关注列表刷新对 B 站的“每房间 2 次请求”最容易放大

当前刷新逻辑（前端）对每个关注主播都发一次 invoke；其中 B 站后端又会额外请求 WBI keys（见 2.2）。  
当关注数多时，这类冗余请求不仅影响性能，也容易触发平台限频/验证码（README 也提示过频请求风险）。

**建议优先级**：先做 2.2（WBI keys 缓存），再考虑更进一步的“批量刷新”接口（把 N 个房间合并成 1 次后端调用并在后端做并发/限速）。

---

## 4) 建议的落地顺序（按性价比）

1. 播放器模块动态加载（1.1）——首屏收益最大、改动相对可控
2. 图片代理缓存策略（2.1）——直接减少冗余请求与解码
3. 弹幕链路降噪（2.3）——高弹幕场景明显降低 CPU
4. B 站 WBI keys 缓存（2.2）——关注刷新场景立竿见影
5. 关注持久化节流（1.2）——关注数量大时更顺滑
6. 逐步统一/复用 HTTP client、消除 blocking client（2.5）——偏工程化治理

