# 局域网数据同步（桌面端 ↔ 移动端）

本功能用于在**同一局域网**内同步 DTV 的用户数据（关注列表、自定义分区订阅等）。桌面端作为“共享端”启动一个固定端口的 HTTP 服务，接收端通过手动输入共享端 IP 完成导入。

## 总览

- 固定端口：`38999`
- HTTP 接口：
  - `GET http://<host>:38999/dtv-sync`：返回 **Manifest（预览）**
  - `GET http://<host>:38999/dtv-sync/payload`：返回 **Payload（完整数据）**
- 无鉴权/无验证：仅建议在可信局域网使用
- 导入策略：**增量合并**，不覆盖本地，重复跳过

## 手动输入 IP（移动端/桌面端通用）

当前实现不做自动发现：接收端需要手动输入共享端的 IP（端口固定 `38999`），然后直接请求：

- `GET http://<ip>:38999/dtv-sync`
- `GET http://<ip>:38999/dtv-sync/payload`

## 数据协议

### Manifest（预览）

路径：`/dtv-sync`

```json
{
  "kind": "dtv-lan-sync",
  "version": 1,
  "exportedAt": "2026-04-21T12:34:56.000Z",
  "source": { "client": "desktop", "appVersion": "3.0.0" },
  "summary": {
    "followedStreamers": 12,
    "followFolders": 3,
    "followListOrder": 15,
    "customCategories": 5,
    "totalBytes": 12345
  }
}
```

### Payload（完整数据）

路径：`/dtv-sync/payload`

```json
{
  "kind": "dtv-lan-sync",
  "version": 1,
  "exportedAt": "2026-04-21T12:34:56.000Z",
  "source": { "client": "desktop", "appVersion": "3.0.0" },
  "entries": {
    "followedStreamers": "[ ...JSON 字符串... ]",
    "followFolders": "[ ...JSON 字符串... ]",
    "followListOrder": "[ ...JSON 字符串... ]",
    "dtv_custom_categories_v1": "[ ...JSON 字符串... ]"
  }
}
```

注意：`entries` 的 value 是**字符串**（对应桌面端 localStorage 原值），移动端需要对字符串再做一次 `JSON.parse()`。

## 字段与数据结构（必须与桌面端一致）

### 1) `followedStreamers`

localStorage key：`followedStreamers`

类型：数组

```ts
type Platform = "DOUYU" | "DOUYIN" | "HUYA" | "BILIBILI";

type FollowedStreamer = {
  id: string;
  platform: Platform;
  nickname: string;
  avatarUrl: string;
  roomTitle?: string;
  currentRoomId: string;
  liveStatus: "UNKNOWN" | "LIVE" | "OFFLINE";
};
```

唯一键：`platform + ":" + id`（platform 大写）。

### 2) `followFolders`

localStorage key：`followFolders`

```ts
type FollowFolder = {
  id: string;
  name: string;
  streamerIds: string[]; // 每个元素形如 "DOUYU:12345"
  expanded?: boolean;
};
```

### 3) `followListOrder`

localStorage key：`followListOrder`

```ts
type FollowListItem =
  | { type: "folder"; data: FollowFolder }
  | { type: "streamer"; data: FollowedStreamer };
```

### 4) `dtv_custom_categories_v1`

localStorage key：`dtv_custom_categories_v1`

类型：数组，每个元素至少包含 `key: string`，并带有平台/名称/链接等字段（移动端应原样保存）。

唯一键：`key`。

## 导入（增量合并）规则

推荐按桌面端实现保持一致（见 `web/src/services/lanSync.ts` 的 `applyIncrementalLanSyncImport`）：

1. 关注列表：按 `platform:id` 去重，缺失则新增。
2. 文件夹：
   - 优先按**文件夹名（不区分大小写）**匹配本地文件夹；匹配到则合并 `streamerIds`（去重、规范化为 `PLATFORM:ID`）。
   - 未匹配到则创建新文件夹（`id` 可使用 UUID），并标记 `expanded=true`。
3. 列表顺序：
   - 保留本地 `followListOrder` 的相对顺序；
   - 新增的文件夹追加到末尾；
   - 新增且不在任何文件夹内的主播追加到末尾；
   - 已在文件夹内的主播不应同时出现在顶层列表。
4. 自定义分区：按 `key` 去重，缺失则追加。

## 结束共享

桌面端提供“停止共享”能力：停止 HTTP 服务。
