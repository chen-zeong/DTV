# 直播流如何获取并展示（代码导读）

这份文档解释本项目里「直播流 URL 如何获取」以及「如何在前端播放器展示」的完整链路，方便后续定位与改动。

## 总览

直播流链路分两段：

1. 获取：根据平台 + roomId 拿到可播放的 `streamUrl`（部分平台会转成本地代理 URL）。
2. 展示：把 `streamUrl` 喂给前端播放器 `xgplayer`（FLV/HLS 插件不同）。

## 从哪里进入播放页

- 路由定义：`src/router/index.ts`
  - `/player/:platform/:roomId` -> `src/pages/UniversalPlayerView.vue`
- 首页点击进入：`src/pages/PlatformHomeView.vue`
  - `router.push({ name: "UniversalPlayer", params: { platform, roomId } })`

## 播放页如何触发获取直播流

- 播放页组件（核心）：`src/components/player/index.vue`（MainPlayer）
- 核心初始化逻辑：`initializePlayerAndStream(...)`
  - 根据 `props.platform` 分发到各平台的 `playerHelper` 获取 `{ streamUrl, streamType }`
  - 拿到配置后调用 `mountXgPlayer(...)` 创建播放器并开始播放

各平台分发点（同文件 `src/components/player/index.vue`）：

- 斗鱼：`getDouyuStreamConfig`（`src/platforms/douyu/playerHelper.ts`）
- 抖音：`fetchAndPrepareDouyinStreamConfig`（`src/platforms/douyin/playerHelper.ts`）
- 虎牙：`getHuyaStreamConfig`（`src/platforms/huya/playerHelper.ts`）
- B站：`getBilibiliStreamConfig`（`src/platforms/bilibili/playerHelper.ts`）

## 直播流如何展示（播放器层）

- 播放器创建：`src/components/player/index.vue` -> `mountXgPlayer(...)`
  - 使用 `xgplayer`：`new Player({ url: streamUrl, isLive: true, autoplay: true, ... })`
  - 根据 `streamType` 选择插件：
    - `flv` -> `xgplayer-flv`
    - `hls` -> `xgplayer-hls.js`
  - B站 HLS 额外设置了请求头/Referrer（避免拉流被拦）：同函数内 `xhrSetup` 与 `fetchOptions`

## 各平台直播流获取细节

### A. 斗鱼 Douyu（FLV + 本地代理）

前端：`src/platforms/douyu/playerHelper.ts`

1. `invoke("get_stream_url_with_quality_cmd", { roomId, quality, line })`：向 Rust 获取真实上游 FLV 地址
2. `invoke("set_stream_url_cmd", { url })`：把上游地址写入 Rust 侧 `StreamUrlStore`
3. `invoke("start_proxy")`：启动本地 actix-web 代理服务，返回本地播放地址（形如 `http://127.0.0.1:34719/live.flv`）
4. 前端将该本地 URL 交给 xgplayer 播放（浏览器端不直接跨域请求斗鱼）

Rust：

- 命令入口：`src-tauri/src/main.rs` -> `get_stream_url_with_quality_cmd`
- 地址解析：`src-tauri/src/platforms/douyu/stream_url.rs`
  - 走斗鱼 H5 接口
  - 使用 deno/js runtime 执行加密 JS 以生成签名参数
  - 最终拼出可拉的地址（以 FLV 形式给播放器/代理使用）
- 代理服务：`src-tauri/src/proxy.rs`
  - `/live.flv` 从 `StreamUrlStore.url` 取上游地址，然后用 `reqwest` 流式转发给前端

### B. 虎牙 Huya（直接 URL，通常是 FLV）

前端：`src/platforms/huya/playerHelper.ts`

- `invoke("get_huya_unified_cmd", { roomId, quality, line })`
- 从返回的 `flv_tx_urls` 里按画质挑一个 URL
- 直接交给播放器（通常不走本地代理）

Rust：`src-tauri/src/platforms/huya/stream_url.rs`

- 抓取虎牙页面/接口
- 解析出流信息并生成 anti-code
- 构造 FLV 候选列表并返回 `HuyaUnifiedResponse { flv_tx_urls, title, nick, avatar, ... }`

### C. 抖音 Douyin（直接 URL，FLV 为主）

前端：`src/platforms/douyin/playerHelper.ts`

- `invoke("get_douyin_live_stream_url_with_quality", { payload, quality })`
- Rust 返回 `LiveStreamInfo`：包含 `stream_url/title/anchor_name/avatar/status`
- 前端将 `stream_url` 当作 FLV 播放（`streamType` 一般落到 `flv`）

Rust：

- 实现：`src-tauri/src/platforms/douyin/douyin_streamer_detail.rs`
- Web API：`src-tauri/src/platforms/douyin/web_api.rs`
  - 调 `webcast/room/web/enter`（带 `a_bogus`）拿到房间 JSON
  - 从 `stream_url.flv_pull_url` 里按清晰度挑选 FLV 地址

### D. B站 Bilibili（可能 FLV 走代理，也可能直接 HLS）

前端：`src/platforms/bilibili/playerHelper.ts`

- `invoke("get_bilibili_live_stream_url_with_quality", { payload, quality, cookie })`
- Rust 可能返回：
  - `stream_url = http://127.0.0.1:.../live.flv`（FLV 代理模式）
  - 或 `stream_url = https://...m3u8`（HLS 直连模式）

Rust：`src-tauri/src/platforms/bilibili/stream_url.rs`

- 调用 B 站 `getRoomPlayInfo` 等接口枚举可用流
- 优先拿到 FLV：
  - 写入 `StreamUrlStore` 并调用 `start_proxy` 返回本地代理 URL
- 否则选择 HLS：
  - 会探测候选 m3u8 的可用性
  - 直接把 HLS URL 返回给前端播放器

## 最短排查路径（推荐）

1. `src/components/player/index.vue`：`initializePlayerAndStream` -> `mountXgPlayer`
2. 对应平台 `src/platforms/*/playerHelper.ts`：决定调用哪个 `invoke`、是否走 proxy
3. Rust command 侧实现：
   - 斗鱼：`src-tauri/src/platforms/douyu/stream_url.rs` + `src-tauri/src/proxy.rs`
   - 虎牙：`src-tauri/src/platforms/huya/stream_url.rs`
   - 抖音：`src-tauri/src/platforms/douyin/douyin_streamer_detail.rs`
   - B站：`src-tauri/src/platforms/bilibili/stream_url.rs` + `src-tauri/src/proxy.rs`
