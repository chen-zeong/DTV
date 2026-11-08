# Changelog

## Unreleased

### 修复

- **直播流偶发断流自动重连**：弱网或 CDN 抖动导致 FLV 读到 EOF 时，之前会直接
  进入"主播下线"空态。现在分两层自愈：
  1. `xgplayer-flv` / `hls.js` 先按 chunk 自行重试；
  2. 仍然断开时，播放页重新拉房间信息与取流地址，并用新的 nonce 重建播放器
     实例（即使 URL 字符串没变），退避 2s→4s→8s→16s→30s，网络恢复后立即重试。
  只有房间接口两次都确认未开播才显示"主播暂时没有开播"；首次加载超过
  20 秒、播放中缓冲超过 10 秒也会触发重连。重连期间显示"正在第 N 次自动重连"，
  可手动立即重连，恢复播放后提示"直播已重新连接"。
- **窗口全屏按钮不再随宽度消失**：控制栏在 `max-width: 1100px` 的媒体查询里
  曾把「窗口全屏」按钮 `display: none`，窗口比例较窄时入口会消失。现在该
  断点只收紧间距和音量条宽度，窗口全屏按钮始终显示。
- **窗口尺寸/位置记忆修复**：之前最小化会触发窗口移动/缩放事件，把 Windows
  最小化时的哨兵坐标（如 `-18285`）写进 `window.json`，下次启动就被判定为
  无效位置，只能回到默认尺寸。现在：
  - 最小化时不再读取当前坐标，只保存最后一次普通窗口 bounds；
  - resize/move 时先捕获普通窗口 bounds，再做 400ms 防抖写盘，拖完立刻
    最小化/关闭也不会丢尺寸；
  - 启动时忽略非法坐标，但保留已保存的宽高。
- **弹幕设置记忆检查**：播放器弹幕面板里的开关、颜色、描边、彩色弹幕、
  字号、速度、显示区域、透明度，以及面板宽度/折叠状态、屏蔽关键词都已
  通过 localStorage 持久化；本次检查未发现漏存字段。
- **播放器回到单一 xgplayer-flv 方案**：移除 mpegts.js 实验、WebView2 GPU
  启动参数、自动降清晰度和所有固定时间戳偏移；所有平台 FLV 统一走
  `xgplayer-flv`，HLS 走 `xgplayer-hls.js`，只保留原有的断流重连。
- **直播缓冲/重试参数按弱网调整**：FLV `retryCount` 8、`retryDelay` 1.2s、
  `disconnectRetryCount` 10，`preloadTime` 8 / `targetLatency` 8 /
  `maxLatency` 24 / `disconnectTime` 30，`maxReaderInterval` 8s、
  `loadTimeout` 20s、`longtimeNoReceived` 5s；HLS 的 manifest/level/frag
  重试也统一放宽到 8–10 次、1.5s 间隔。弱网下优先多缓冲、多重试，不再用
  激进阈值判断断流。
- **书页·日顶栏背景与页面统一**：之前 `Navbar` 固定铺一层 `--bg-primary`
  实色，和下方带暖色暗角/纸纤维的页面背景对不上；现在只有 `parchment`
  主题把顶栏背景设为透明，直接透出下方同一张纸张背景，其他主题保持不变。
- **窗口全屏也显示系统窗口按钮**：以前只有系统全屏（DOM Fullscreen）会把
  最小化 / 最大化还原 / 关闭三个按钮搬到画面右上角；窗口全屏（播放器铺满
  应用窗口）下应用标题栏被盖住，就没有关闭入口。现在两种全屏共用同一个
  `PlayerCaptionButtons`，位置、悬停样式、关闭行为、跟随控制栏淡出完全一致。
- **斗鱼部分高码率直播间播放卡顿**：`xgplayer-flv` 原来的直播缓冲只有
  `preloadTime: 5`，且 `disconnectTime` 被设成 4 秒——后者是"暂停/卡住时
  buffer 领先超过多少秒就重连"的阈值，对 1080P60 这类高码率房间太激进，
  会反复 disconnect。现在对齐 pure_live 的 mpv 直播调优：8 秒 readahead、
  `maxLatency: 16`、`targetLatency: 8`、`disconnectTime: 20`，并保留
  `maxJumpDistance: 5`。低码率房间不受影响，高码率房间不再频繁追帧/重连。
- **斗鱼手机开播 / 直播伴侣音画不同步**：这类 NVENC 推流的视频 tag 时间戳
  是 DTS，`PTS=DTS+CTS` 因 B 帧重排会比音频晚 60–100ms，而音频没做补偿
  （OBS 一般会补偿）。现在本机 FLV 中继在首段同时拿到首个音频和首个视频
  tag 后，若两者 PTS 差在 40–500ms 内，就把后续所有音频 tag 的时间戳整体
  平移相同差值（300 秒续流段也沿用同一偏移），让首帧音画落在同一 PTS；
  差值小于 40ms 的正常流不会被改动。补了单元测试。
- **exe 属性里版本号空白**：`build/windows/info.json` 的字符串表缺
  `FileVersion` 键，Windows 只读到了 fixed 版本号，Explorer / PowerShell
  的文件版本字段都是空。`sync-info-version.mjs` 现在同时写
  `FileVersion` 与 `ProductVersion`，并补齐 `InternalName` /
  `OriginalFilename`；已用 `FileVersionInfo` 验证 4.1.0 / DTV 均可见。
- **弹幕断线自动重连补全**：B 站弹幕 `run()` 原来是一次性的，`roomInit` /
  `danmuInfo` / WS 任一环节失败就直接退出，房间还开着但弹幕永久断联。现在
  改成带退避的循环重连；斗鱼 / 虎牙 / 抖音 / B 站都在连接稳定运行 10 秒后
  重置退避，偶发一次断线不会永久按 30 秒重连。
- **斗鱼搜索结果在线状态反了**：搜索接口 `isLive` 实测是 `1=直播中、2=未开播`，
  旧代码按 `2=直播中` 归一化，导致在线圆点全挂在离线主播上。已修正并补单测。
- **搜索结果在线圆点改为绿色**：列表里的 `dotLive` 使用新的
  `--status-online`（深色 `#22c55e` / 浅色 `#16a34a`），不再和 LIVE 红色混用。
- **滚动弹幕不显示（右侧列表正常）**：`danmu.js` 的 npm 包是 CJS/UMD，
  导出形状为 `{ default, DanmuJs }`；Vite 下 `import DanmuJs from "danmu.js"`
  拿到的是模块命名空间对象，`new DanmuJs()` 抛 `TypeError: DanmuJs is not a
  constructor`，而 `DanmuOverlay` 的 catch 只打日志，所以容器一直是空的。
  现在显式取 `DanmuModule.DanmuJs ?? DanmuModule.default` 并加空值保护；
  已用独立页面验证 `.danmu` 容器能分轨、滚动。
- **斗鱼「娱乐天地」下重复出现「一起看」**：斗鱼的 `cate2Info` 现在会**间歇性**
  下发 `208 一起看`，而 `categories.go` 里还保留着"接口不下发时手动补一个"的
  旧逻辑，于是有些请求会返回两个同 id 的「一起看」；前端用 `category.id` 做
  React key，重复 key 在切换一级分区时会留下/复制 chip，表现为每切一次多一个。
  现在后端按 `cate2Id` 去重，并只在确实没有「一起看」时才补；前端
  `mapCategoryGroup` 再按 id 兜一层去重。
- **启动默认页**：有订阅分区时，应用启动直接进入「订阅」Tab；没有订阅时保持
  斗鱼首页。改 hash 在 HashRouter 挂载前完成（`main.tsx`），不会先闪一下斗鱼
  首页再跳；`#/huya`、`#/player?...` 这类深链接不覆盖。
- **斗鱼登录后取流 403「鉴权失败」**：斗鱼一次登录会同时下发 Web 版
  `dy_auth` 与 H5 版 `acf_auth + acf_jwt_token` 两套会话。之前把整份 Cookie
  原样发给 `getEncryption` / `getH5PlayV1`，两套 token 混发会被斗鱼边缘直接
  返回 403（没有 API error），进入直播间一直提示鉴权失败。
  现在 `DouyuClient.requestCookie` 会按会话类型裁剪：
  - H5 对（`acf_auth` + `acf_jwt_token`）齐全时只发 `acf_*` + `dy_did`，
    不发 `dy_auth`；
  - 否则退回 `dy_auth`（Web 会话）或匿名；
  - 单发 `acf_auth` / `acf_jwt_token` 同样会 403，因此绝不单发；
  - `LTP0` 只用于 passport `safeAuth` 续期，不进入取流请求。
  实测（`9999`，真实登录 Cookie）已返回「原画2K60」，`getH5PlayV1` 不再 403。
- **斗鱼中继与登录态不同步**：`StreamRelayService` 原来自己 new 了一个
  `douyu.Client`，中继续流时按游客重新取流，登录用户的原画会被降档。
  现在 main.go 把同一个 `*douyu.Client` 同时交给 `DouyuService` 和中继，
  登录 Cookie / did / 加密描述符缓存共用。实测「登录 → 中继 → FLV」可读到
  `video/x-flv`。
- 斗鱼昵称改为优先读 `acf_nickname`（之前读 `acf_username`，在部分账号上
  是 uid，会显示一串数字）。
- **B 站登录入口只保留在播放页**：顶栏不再显示「扫码登录 / 退出登录」，
  切平台时顶栏布局也不再因为多一个按钮而跳动。播放页主播胶囊里的登录入口
  与登录态保持不变。
- **B 站退出登录现在会真正退出**：
  - 前端先清本地 Cookie/UI，再调用后端 `BilibiliLogout`；
  - 后端调用 passport `login/exit/v2`（带 `bili_jct` 作为 CSRF）让服务端
    SESSDATA 失效，然后清空 Cookie 与 HTTP cookie jar；
  - 之前只把平台 Cookie 字段置空，`http.Client` 仍会把 jar 里的 SESSDATA
    自动加回请求头，表现是"界面已退出、请求仍是登录态"。
  - 登录/退出后播放页会收到 `dtv:bilibili-auth-changed` 自动重新取流，
    清晰度档位立即按新登录态更新。
- **斗鱼扫码登录补全设备号绑定**：二维码生成/轮询/登录回调请求现在都会带上
  本进程的 `dy_did`（斗鱼网页端在登录前由 `douyu-did.js` 写入），避免服务端
  把登录态绑定到另一个设备号、后续取流仍按游客降档。
  登录成功后还会用 passport `safeAuth` 校验/续期一次，昵称从登录 Cookie 的
  `acf_username` 解析。退出登录同样会清空 cookie jar。
- **滚动弹幕去掉投影**：`text-shadow` 只保留四向描边，不再有
  `0 2px 6px rgba(0,0,0,.7)` 的阴影，密集弹幕叠在画面上时不再发灰。

### 新增

- **六套主题配色，同色系日夜成对**：顶栏「主题配色」面板改成 2 列 3 行：
  青柠·夜 / 青柠·日、黑白灰·夜 / 黑白灰·日、琥珀·夜 / 书页·日。
  - 青柠保留 4.x 的默认夜间与旧日间浅色；
  - 黑白灰夜/日是无彩色版本；
  - 琥珀夜是暖炭黑 + 琥珀橙，书页日用米纸、象牙白、深棕墨色和赭石橙，
    做出旧书页/牛皮纸的观感；
  - 夜间主题的预览中间色统一为 `#14161b` 纯灰，表面色同步中性化。
  每套同时覆盖背景/表面/文字/强调/状态色，并继续设置 `data-theme` 兼容旧的
  `[data-theme="light"]` 样式；选择写入原有 `theme_preference`，旧的
  `dark` / `light` / 上一轮九套主题 id 会自动映射到对应的 6 套。
- **播放器控制栏适配日间主题**：控制栏仍浮在深色视频上，但图标/音量百分比
  的激活色改用主题单独的 `--player-accent`，不再直接继承页面强调色：
  青柠日用亮青柠、黑白灰日用纯白 + 辉光、书页日用亮琥珀，避免黑色/深赭色
  图标在视频上“消失”。
- **抖音新增「忍者必须死3专区」**：作为独立一级分组加入抖音分区表，分类 id
  `1_1010129`，可直接从首页进入该专区。

### 调整

- **版本号改为 4.1.0**（`build/config.yml`、`build/windows/info.json`、
  `frontend/package.json`、MSI 构建脚本统一）。
- **分区栏重新排布**：去掉首页顶部的 6px 空隙；一级 14px / 二级 13px /
  三级 12px 的字号层级，行间距、内边距整体放宽；一级选中改为浅强调色圆角底，
  二级选中为强调色圆角矩形，三级选中为浅强调色；日间/夜间都跟随主题变量，
  去掉了只在深色下成立的 inset 高光。
- **滚动弹幕换成 bytedance/danmu.js 1.2.1**：移除 `@ironkinoko/danmaku`。
  用假 `player` + `live` 模式驱动直播弹幕；保留自定义 DOM（文字 + 官方表情图）、
  描边、透明度、显示区域、字号、时长和滚动/顶部/底部模式。卸载时手动清理
  danmu.js 内部 50ms resize 定时器。
- **数据同步导入老订阅分区**：老版虎牙存的是完整网页 URL、B 站存
  `/category/2_86`、抖音存 `/category/1_1_1_xxx`、斗鱼存 shortName。导入时
  原先只读 `cate2Id/douyuId/key`，路径形式的 id 会被丢掉或原样传给接口，
  表现为“订阅能显示、列表拉不到”。现在统一转换成当前接口 id；斗鱼后端
  另外按 shortName/分区名反查数字 cate2Id（例如 LOL → 1），虎牙后端也兼容
  完整 URL。
- **B 站封面首屏**：`SmoothImage` 在图片代理就绪前先占位，不再先发一次注定
  403 的直连请求；图片代理改为直连、启用 HTTP/2、每 host 连接池 16，
  减少一页几十张 `i0.hdslb.com` 封面的排队。
- **未签名 MSI 安装包**：Wails 官方只提供 NSIS（`.exe`）和 MSIX，这里用
  WiX v3 的 `candle`/`light` 生成真正的 Windows Installer：
  `build/windows/msi/dtv.wxs` + `build/windows/msi/build-msi.ps1`，
  Taskfile 入口 `wails3 task windows:msi WIX_BIN=...`。
  per-user 安装到 `%LOCALAPPDATA%\Programs\DTV`，带开始菜单/桌面快捷方式，
  卸载自动清理；MSI 和内部 `dtv.exe` 均不做 Authenticode 签名。
- **右侧弹幕列表默认宽度 224 → 196**（可拖拽范围 200–360 → 168–320）。
  存储键同时从 `dtv_danmu_panel_width_v1` 换成 `_v2`，否则老用户会一直停在 224。
- **弹幕库换成 `@ironkinoko/danmaku` 2.0.1**（`weizhenye/Danmaku` 的高性能分支，MIT）。
  滚动改成 CSS keyframe 动画，主线程不再每帧用 JS 改 `transform`；直播模式下
  处理过的弹幕会被丢弃，挂一晚上不会越积越多；顺带拿到 TS 类型与
  `scrollAreaPercent` / `opacity` / `merge` 这些设置项。
  同一份输入压力下的实测（headless Chrome，40 条/秒，各 3 轮）：
  脚本时间 10~18ms/s（旧：63~77ms/s，同一份输入），丹幕库 chunk 从 69KB 降到 12KB。
- **弹幕表情改成官方表情图**：收录 B 站 324 张 + 抖音 222 张官方表情
  （`frontend/public/emotes`，约 4.4MB，由 `scripts/gen-emotes.mjs` 从 `bilicon` 生成）。
  `[看]` `[捂脸]` `[doge]` 这类正文现在渲染成真正的表情图，视频弹幕层和右侧弹幕列表
  都是；官方表情包没收的叫法仍走 Unicode 表情，再兜底 `emojibase` CLDR 中文表。
  解析结果做了相邻文本合并，不会一个汉字一个 `<span>`。
- 音量条去掉拖动手柄：整条（18px 高）都是热区，按住左右滑即可调音量，
  点击直接跳到该位置；键盘 ←/→ 5%、PageUp/PageDown 10%、Home/End 到两端。
  宽度改用 `--volume-slider-width` 自定义属性，窄窗口收窄不再和组件自身样式打架。
- 弹幕开关改回图标按钮（`MessageSquare`，开启时用强调色高亮，关闭时是
  `MessageSquareOff`），不再占「弹幕」文字 + 胶囊开关的宽度。

### 修复

- **斗鱼彩色弹幕全显示成黑色**：斗鱼弹幕的 `col` 字段是**调色板索引**（官方协议
  "col 颜色:默认值 0(表示默认颜色弹幕)"），我们却按"十进制 RGB"解析，
  于是 `col=4` → `#000004`（几乎全黑），`col` 缺省的白弹幕看起来才正常。
  实测热门房真实取值是 1~7。色表取自**斗鱼官方 web 播放器 bundle**
  （`live_player-master/js/h5-plugin_*.js`：
  `case 1:"#ff2e2e" / 2:"#00ccff" / 3:"#66ff00" / 4:"#ff6600" / 5:"#cc00ff" / 6:"#f6447f" / 7:"#ff84f6" / default:"#ffffff"`）。
  空 / 0 / 未知索引一律回落前端默认白色（绝不返回黑色），`>= 0x10000` 才按十进制 RGB 兜底。
  顺带核对：虎牙（int32 RGB，默认 16777215）与 B 站（十进制 RGB）的解析本来就是对的，
  抖音弹幕不带颜色（前端也不显示彩色开关）。

- **切直播间时旧直播间没有销毁**：同一个 `/player` 路由只改 query 时 React 复用同一个
  `PlayerPage`，而 `info` 在新房间的数据回来之前还是旧的，`useXgPlayer` 的 effect
  依赖（`url`）没变，于是**旧房间继续拉流/出声**，新房间只是叠上去。
  现在 `routes.tsx` 用 `PlayerRoute` 给 `PlayerPage` 加了
  `${platform}:${roomId}` 的 key：换房间等于整页重建，播放器 destroy、
  弹幕退订、定时器清理全走正常卸载路径。
- **抖音清晰度阶梯排错 / 标签错位**：实测（2026-11，多间房一致）服务端阶梯是
  `origin 原画(≈20Mbps) > uhd 蓝光(8Mbps/1440x1080) > hd 超清(6Mbps) > sd 高清(2Mbps) >
  ld 标清(1Mbps) > md 流畅(0.8Mbps)`，而 `flv_pull_url` 的 key 与中文名是**错位**的：
  `SD1` 对应 `_ld.flv`（1Mbps，最低）、`SD2` 对应 `_sd.flv`（2Mbps）。旧代码按
  `SD1=高清、SD2=标清` 映射，还把 `SD2` 当"用不到的最低档"删掉 —— 等于把「高清」删了、
  把「标清」标成了「高清」。
  现在统一以 `stream_data.data` 为权威阶梯（带 `vbitrate / fps / resolution / VCodec`），
  `flv_pull_url` 只做兜底、并按文件名后缀（`_or4/_uhd/_hd/_sd/_ld`）判定档位；
  菜单变成「原画 / 蓝光 / 超清 / 高清 / 标清」五档，不再错位、不再丢档。
  结论：**原画是最高画质**（20Mbps，未转码的原始推流），蓝光是最高一档转码（8Mbps）。
- **抖音「原画」取不到**：`stream_url.flv_pull_url` / `hls_pull_url_map` 里
  **没有 ORIGIN**，只有 `FULL_HD1 / HD1 / SD1 / SD2`（实测 2026-11 多间房一致），
  所以旧代码永远拿不到原画，只把蓝光改名成「原画」。
  真实原画在 `stream_url.live_core_sdk_data.pull_data.stream_data`（内嵌 JSON 字符串）
  的 `data.origin.main.{flv,hls}`，编码参数在同级 `sdk_params.VCodec`。
  旧 Tauri 版（`web_api.rs` 的 `merge_origin_stream`）就是靠这段补 ORIGIN 的，
  移植时漏掉了；现在补回来了（同时兼容 `pull_datas[].stream_data`）。
  - 原画是 **H.265** 时：标签显示「原画 · H.265」、优先给 HLS（FLV 里的 HEVC 基本
    进不了 MSE），并**排到第 2 位**，保证默认档位一定能播（WebView2 的 HEVC 支持
    依赖系统解码器）。实测目前多数房间原画是 H.264（`VCodec: h264`、`_or4.flv`）。
  - 原画是 **H.265** 时（实测很罕见：扫过 40 间在线房全是 h264）：保留「原画 · H.265」，
    同时**实测** `&codec=h264` 那一路是不是真能给到 H.264 原画（读 FLV 首个 video tag
    的 CodecID，不信参数存在就当数）。能拿到就并行多给一档「原画 · H.264」并让它当默认档，
    拿不到就把 H.265 那档退到第二位、默认档退回蓝光，避免默认档在缺 HEVC 解码器的设备上黑屏。
  - 顺带确认：原画 URL 追加 `&codec=<VCodec>` 与不追加都能 200 拿到
    `video/x-flv`，所以不追加（避免动到带签名的 URL）。
- **4:3 屏幕上弹幕"消失"**（全屏播放 16:9 画面、上下有黑边时）：弹幕全落在黑边里
  就看不见，弹幕多到压在画面上、或者鼠标唤出主播信息后又能看见。
  根因是 xgplayer 让 `<video>` 元素铺满整个舞台，黑边是**元素内部**用
  `object-fit: contain` 留出来的；WebView2 把视频提升成硬件叠加平面
  （DirectComposition overlay）时，这块平面连同元素区域里的黑色一起盖在网页内容
  之上 —— 只有在"画面上没有任何内容压着视频"时浏览器才会走叠加平面，所以弹幕越少、
  越全在黑边里越必然触发；一旦有弹幕压在画面上、或玻璃胶囊的 `backdrop-filter`
  逼视频退出叠加平面，就恢复正常。
  现在 `useXgPlayer` 按 `videoWidth/videoHeight` 把 video 元素收缩成画面矩形
  （内联 `inset:0 + margin:auto` 居中），黑边改由 `.stage` 的黑背景来画，
  那一层永远不会盖住弹幕；画面比例也不再经过第二次 `object-fit` 缩放。
  顺带修掉一条死规则：`.videoHost` 与 xgplayer 根节点是同一个元素，
  原来的 `.videoHost > .xgplayer` 永远不匹配。
- 弹幕表情图被 Tailwind preflight 的 `img { display: block }` 影响，每个表情各自
  独占一行、弹幕节点宽度也算错（轨道因此错位）。`.emote` 显式 `display: inline-block`。
- 关注列表：展开侧栏时新建的**空文件夹被压成一条横线**。根因是 column 方向的 flex
  会按比例压缩子项，而 `.folder` 的 `overflow: hidden` 让它的自动最小尺寸变成 0；
  现在文件夹/列表不再参与收缩，超出高度走滚动。
- 关注刷新：刷新状态提升到 `FollowProvider`，启动后那次自动刷新同样会让刷新按钮
  转圈；刷新中按钮外套一圈圆环进度条，并通过 `title` 显示 `已完成/总数`。
- 直播状态判定对齐旧 Tauri 版：斗鱼要求 `show_status==1` 且非轮播（`videoLoop/isLoop`），
  B 站只认 `live_status==1`（轮播 2 按未开播处理），抖音以 `status==2` 为准。
  这样刷新后已经下播的主播不会再一直显示"直播中"。
- 分区：切换平台/二级分区后，斗鱼的三级分类默认停在「全部」，不再默认选第一个。
- 分区栏：主播列表上滑时一级/二级/三级分类不再折叠成一行。

### 调整（早前）

- 关注列表按状态排序：直播中的排在最前，未开播的排后面（顶层列表与文件夹内部一致）。
  只影响展示，不改动持久化的手动顺序。
- 文件夹之间的上下间距收窄（去掉与 `.content` gap 叠加的 `margin-bottom`）。
- 播放页改成"全屏播放器"布局：主播信息条与底部控制条悬浮在画面上，不再占据布局高度；
  全屏下鼠标静止 2.8s 后自动淡出，移动鼠标立刻恢复。舞台不再锁死 16:9，
  画面用 `object-fit: contain` 自适应，弹幕层因此能覆盖到画面以外的黑边
  （3:4 屏幕全屏时弹幕不会再"只出现在画面里"）。
- 主播列表底部内边距去掉，滚动区域铺到窗口下沿。
- 订阅分区 chip 的平台文字前不再画品牌色圆点。
- 关注状态刷新并发数 3 → 6（`REFRESH_CONCURRENCY`），关注多时明显更快。
- 弹幕设置面板的「彩色弹幕」开关只对支持原生颜色的平台显示
  （斗鱼 / 虎牙 / B 站；抖音弹幕本身不带颜色），颜色解析放宽到 `#RGB` 与 `#RRGGBB`。
- 弹幕「显示区域」滑杆补上「全屏」（0.25 / 0.5 / 0.75 / 1），之前上限锁在 3/4。
- 未开播时播放器没有实例，`PlayState` 新增 `idle`：控制栏刷新按钮不再一直转圈。
- 抖音分区列表首屏从 3.4s 降到约 0.6s：首页 cookie 预热（换 ttwid）原来同步挡在
  列表请求前面，现在改为后台预热，并把响应的 body 读干净以便复用 TLS 连接。
- 播放器控制栏新增「小窗」按钮（原生 Picture-in-Picture，等同 xgplayer 的 pip 插件；
  不支持的环境自动隐藏）。
- 新增「弹幕屏蔽」：控制栏漏斗图标 → 输入关键词（回车/添加）→ 标签点击移除 + 清空，
  命中关键词的弹幕在入库前就被丢掉（视频弹幕层与右侧列表都不出现）。
  关键词对所有平台生效，存 `danmu_block_keywords`（与老版同一个键）。
- 日间模式下控制栏右侧的清晰度/线路/小窗/窗口全屏/全屏改用与夜间一致的白色文字
  （控制条已改成悬浮在画面上，浅底深字的旧规则会把按钮"抹掉"）。
- 弹幕设置 / 弹幕屏蔽弹层在原生全屏下改挂到全屏元素内部，不再因为挂在 body 上而失踪。
- 修复列表"刚好一屏时第二页永远不加载"：内容不足一屏时自动续页
  （浏览器不会产生 scroll 事件，原来只显示"继续下滑加载更多"却滚不动）。
- 应用图标换成老 Tauri 版的 dtv 图标（`build/appicon.png` + `build/windows/icon.ico`）。
- 系统全屏（DOM Fullscreen）下应用标题栏被隐藏，播放器右上角补上
  「最小化 / 最大化还原 / 关闭」三个按钮：46×32、无背景、悬停浅色浮层、
  关闭键悬停转 Win11 的 `#C42B1C`，和系统 caption 按钮同尺寸同线宽；
  它们渲染在 chrome 层里，跟着控制栏与主播信息一起淡出/浮现。
- 样式全屏（窗口全屏）时整块画面都是窗口拖拽区（`--wails-draggable: drag`）：
  标题栏让位后按住画面就能移动窗口；控制栏按钮在 chrome 层（更高 z-index）
  不受影响，状态覆盖层改成 `pointer-events: none` 让拖拽穿透、按钮单独开启命中。
- 控制栏的音量调节换成 HeroUI v3 的 `Slider`（Track / Fill / Thumb），
  弹幕开关换成 `Switch`（Control / Thumb）；只用 CSS 变量把 HeroUI 的
  `--default` / `--accent` / `--accent-foreground` 换成播放器材质，
  组件本身的尺寸、动效、无障碍行为都保留官方实现。
  两者的滑块都改成**白色扁平圆点**（去掉 HeroUI 默认的强调色胶囊 + 内嵌胶囊）。
- 关注列表的文件夹名小一档、淡一档（日间/夜间都调暗，但仍保持可读）。
- 弹幕里的文字表情还原成真表情：抖音的 `[捂脸]` / `[龇牙]`，以及虎牙、斗鱼、
  B 站同类的中括号表情名（含 `[doge]` 这类英文键），在入库前统一替换成 Unicode
  表情；未收录的名字原样保留，不会误伤正常的方括号内容。
- 「窗口全屏」改为西瓜播放器式的**样式全屏**：只让播放器铺满应用窗口（侧栏/顶栏让位），
  不再调用原生窗口全屏，Win11 任务栏照常可见；真正的系统级全屏仍是「全屏」按钮。
- 移植 PR #154 的斗鱼直链续流：新增本地直播流中继服务
  （`internal/services/stream_relay_service.go` + `flv_relay.go`）。
  斗鱼 flv 直链 300 秒后会被 CDN 主动断开，中继在第 295 秒预取新流，
  按 FLV tag 边界接续（丢掉新流文件头/元数据/sequence header，从越过已转发
  时间戳的关键帧接上，按时间戳丢掉 CDN 回吐的旧 GOP）。实测连续播放 340s
  无中断，日志在第 300 秒打出"已接续新的一段"。中继不可用时自动回退直连。
- 播放页顶栏的平台 tab 跟着房间的平台走（之前 `/player` 一律落到斗鱼）。
- 弹幕容器尺寸剧变（进出全屏）后重建 danmu.js 实例：库里残留的轨道/队列状态
  会让新弹幕排不上轨道，表现就是"全屏后弹幕不出来了"。
- 「数据同步」弹窗改紧凑（高度随内容、无底部空白），并按老 Tauri 版对齐功能：
  导出页签带二维码 + IP/端口，导入页签是「一键导入」/「导入 JSON」/ 手动填 IP。
  **去掉配对码**：Go 端令牌固定为 `dtv`（可用 `DTV_LAN_SYNC_TOKEN` 覆盖）并随
  UDP 广播下发，接收端无需任何输入即可导入。

## 4.1.0 — 2026-11-01

本次是 4.0 移植完成后的优化轮，对应 `docs/IMPROVEMENT_REVIEW.md`。
只列用户可感知的变化与关键工程改动。

### 启动与性能

- 播放页改为路由懒加载；`xgplayer` / `danmu.js` 拆成独立 chunk，
  首屏 JS 从约 1.07 MB 降到约 420 KB。
- 图片代理不再阻塞 React 首屏；启动层内联在 `index.html`，首帧即可见。
- 首页 feed 增加模块级缓存（60s）与滚动位置恢复，从直播间返回不再重新请求。
- 列表上限 300 条，卡片启用 `content-visibility`，切换分区不再等待近 1 秒入场动画。
- 图片代理改为流式转发，支持 CDN 侧缩放、磁盘 LRU 缓存、每次启动随机 token。
- 抖音弹幕签名复用同一个 goja 运行时；所有 JS 签名带 3 秒超时。

### 播放器

- 快捷键：`Space/K`、`F`、`M`、`Esc`、`?`（见 `docs/SHORTCUTS.md`）。
- 音量持久化；自动播放被拦截时自动静音续播并给出提示。
- 播放失败自动切换下一条线路；未开播时不再拉流，每 30 秒自动刷新。
- 增加缓冲中状态与窗口全屏（样式全屏）。
- 窗口模式下播放器内不再重复主播胶囊，全屏时才显示完整信息。
- 舞台按 16:9 居中，chrome 隐藏时同时隐藏鼠标指针。
- 右侧弹幕面板可拖拽调宽（200–360px），窗口 <1100px 时改为覆盖层。

### 弹幕

- 消息改为 120ms 批量 flush；面板滚动走 `requestAnimationFrame`。
- 切换线路不再清空/重建弹幕连接。
- 面板行使用 `React.memo`；系统消息单独一行弱化显示。
- 用户上滑后浮出“N 条新弹幕”胶囊；时间戳改为 12px 且对比度达标。

### 导航与状态

- 路由改用 `HashRouter`，刷新不再 404。
- 一级/二级/三级分区同步到 URL（`?g=&c=&s=`），支持深链接与刷新恢复。
- 全局 `ErrorBoundary`：单页崩溃不再白屏，可重新加载/回首页/复制错误。
- 主题只保留深色 / 浅色两态（移除跟随系统），修复首帧读错 storage key 导致的深→浅闪白。
- 搜索支持 `Ctrl+K`、↑/↓/Enter、过期响应丢弃；1100px 以下折叠成图标。
- 首页错误改为非阻塞提示条，保留旧数据并自动退避重试（1s/3s/9s）。

### 视觉与排版

- 卡片/工具组去掉多余描边，改用表面色阶 + 顶部受光边分层。
- 浅色主题强调色拆成“亮青柠填充 + `--accent-ink` 小字”，对比度 > 6:1。
- 圆角收敛到 8/12/16/999 四档，修复 `--radius-2xl` 重复定义。
- 中文辅助字号下限 12px；标题使用 Display 光学尺寸 + 1.22 行高。
- 卡片封面 hover 620ms → 320ms、缩放 1.04 → 1.02；仅保留一个主 affordance。
- 卡片标题允许两行；分类胶囊与当前筛选相同时隐藏。
- 分区面板压缩高度，滚动时收成一行；空关注侧栏自动收成 rail。
- 卡片网格最大 300px 一列、内容区最大 1600px，超宽屏不再出现巨型卡片。

### 桌面能力与稳定性

- 单实例：第二次启动聚焦已有窗口。
- 最小窗口 900×600；窗口位置/尺寸/最大化状态持久化并做屏幕边界校正。
- 托盘未实现；关闭即退出（与旧版一致）。
- 日志落盘到 `%LOCALAPPDATA%\DTV\logs`，按天 + 10MB 轮转。
- WebView2 用户数据目录改到 `%LOCALAPPDATA%\DTV\WebView2`。
- 局域网同步使用每次随机的 6 位配对码，且不再通过 UDP 广播下发。
- 新增 CSP；图片代理 host 白名单收紧到 CDN 子域。
- B 站扫码登录、关注分组弹窗改用共享 `<Modal>`（焦点陷阱/Esc/焦点归还）。
- 版本号由 `build/config.yml` 注入，避免多处硬编码。

### 工程质量

- 新增 ESLint（typescript-eslint + react-hooks）、Prettier、Vitest。
- 新增 GitHub Actions：Go 测试 + typecheck + lint + Vitest + 前端构建。
- 新增 `docs/ARCHITECTURE.md`、`docs/SHORTCUTS.md`，更新 README。

### 尚未实现（保留在路线图）

- 设置页、最近观看、开播通知、弹幕发送/屏蔽词 UI。
- 画中画 / 迷你播放器 / 多窗口拼屏。
- B 站 Cookie 迁移到 Go 侧安全存储。
- 托盘菜单与“关闭到托盘”。
