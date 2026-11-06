import type { LivePlatform } from "@/api";

/**
 * 把老版/网页链接形式的分区 id 归一成当前接口能直接使用的 id。
 *
 * 老 Tauri 版的订阅分区存的是网页 href：
 *   - 虎牙：https://www.huya.com/g/lol      → lol
 *   - B 站：/category/2_86                   → 2_86
 *   - 抖音：/category/1_1_1_1010026          → 1_1010026
 *   - 斗鱼：douyuId 是 shortName（如 LOL）   → 保留，由后端按 shortName 反查数字 id
 *
 * 新版自己的导出已经存的是接口 id，这里的逻辑对它们是幂等的。
 */
export function normalizeSubscriptionId(platform: LivePlatform, raw: unknown): string {
  let id = String(raw ?? "").trim();
  if (!id) return "";

  try {
    id = decodeURIComponent(id);
  } catch {
    // 保留原值，下面再做格式检查
  }

  if (platform === "bilibili") {
    const area = id.match(/[?&]areaId=([^&#]+)/i);
    const parent = id.match(/[?&]parentAreaId=([^&#]+)/i);
    if (area) {
      id = parent ? `${parent[1]}_${area[1]}` : area[1];
    } else {
      id = id.replace(/^.*\/category\//i, "");
    }
  } else if (platform === "douyin") {
    id = id.replace(/^.*\/category\//i, "");
    const parts = id.split("_").filter(Boolean);
    // /category/1_1_1_1010026 → 1_1010026
    if (parts.length > 2) id = `${parts[parts.length - 2]}_${parts[parts.length - 1]}`;
  } else if (platform === "huya") {
    const pathID = id.match(/\/g\/([^/?#]+)/i);
    if (pathID) {
      id = pathID[1];
    } else if (/^https?:\/\//i.test(id) || id.startsWith("//")) {
      const path = id.split(/[?#]/)[0].split("/").filter(Boolean).pop() ?? "";
      id = path;
    }
    id = id.replace(/^g_/i, "");
  } else if (platform === "douyu") {
    const pathID = id.match(/\/category\/([^/?#]+)/i);
    if (pathID) id = pathID[1];
  }

  id = id.replace(/\/+$/, "").trim();
  if (!id || /[\s/?#]/.test(id)) return "";
  return id;
}
