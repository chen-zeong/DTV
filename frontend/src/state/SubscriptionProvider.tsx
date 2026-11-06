import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import type { LivePlatform } from "@/api";
import { STORAGE_KEYS, usePersistentState } from "@/lib/storage";
import { normalizeSubscriptionId } from "@/lib/subscriptionId";

/**
 * 订阅的分区（旧项目里叫"自定义分区 / 收藏分区"）。
 *
 * 数据模型直接对应"平台 + 二级分区"，因为列表页要拿它就着平台接口取流：
 *   - douyu / bilibili 的二级分区 id 本身就能直接查列表
 *   - huya 的二级分区 id 是 iGid，douyin 是 `1_1010032` 这种组合串
 * 所以订阅只存 id，不存"接口形状"，平台差异留给 api 层。
 *
 * 与旧实现的差异：
 *   - 旧版有 `addDouyuCate2` / `addCommonCate2` 两个几乎相同的方法，这里合并成 `subscribe`
 *   - 旧版靠 `entries.length > 0` 决定是否显示入口，入口会"忽隐忽现"；
 *     这里入口常驻（导航里的「订阅」），空态给出引导
 *   - 旧版首屏有个 sessionStorage 魔法键 + effect 里 router.replace 自动跳转，
 *     这里不做隐式跳转
 */

export interface Subscription {
  /** `${platform}:${cate2Id}`，全局唯一 */
  key: string;
  platform: LivePlatform;
  /** 一级分区（"热门游戏"），仅用于展示与回填 */
  cate1Id: string;
  cate1Name: string;
  /** 二级分区 id：取列表时用它 */
  cate2Id: string;
  cate2Name: string;
  createdAt: number;
}

/** 订阅一个分区时需要的字段（key/createdAt 由 Provider 生成） */
export type SubscriptionInput = Omit<Subscription, "key" | "createdAt">;

interface SubscriptionContextValue {
  subscriptions: Subscription[];
  /** 按平台分组，供订阅页按平台分区展示 */
  byPlatform: Array<{ platform: LivePlatform; items: Subscription[] }>;
  isSubscribed: (platform: LivePlatform, cate2Id: string) => boolean;
  subscribe: (input: SubscriptionInput) => void;
  unsubscribe: (platform: LivePlatform, cate2Id: string) => void;
  /** 已订阅则取消，未订阅则订阅 —— 按钮直接接这个 */
  toggle: (input: SubscriptionInput) => void;
  clear: () => void;
}

const SubscriptionContext = createContext<SubscriptionContextValue | null>(null);

const PLATFORM_ORDER: LivePlatform[] = ["douyu", "huya", "douyin", "bilibili"];

export function subscriptionKey(platform: LivePlatform, cate2Id: string): string {
  return `${platform}:${cate2Id}`;
}

/** 洗数据：兼容老版自定义分区数组，并去掉缺字段的、按 key 去重的脏记录 */
function normalize(list: Subscription[]): Subscription[] {
  const seen = new Set<string>();
  const out: Subscription[] = [];
  for (const item of Array.isArray(list) ? list : []) {
    const platform = String(item?.platform ?? "").toLowerCase() as LivePlatform;
    if (!platform || !["douyu", "huya", "douyin", "bilibili"].includes(platform)) continue;

    const keyText = String(item?.key ?? "");
    const keyId = keyText.includes(":") ? keyText.slice(keyText.indexOf(":") + 1) : "";
    const legacy = item as unknown as {
      douyuId?: string;
      cate1Href?: string;
      cate2Href?: string;
      cate2Id?: string;
      cate1Name?: string;
      cate2Name?: string;
    };
    const rawId = String(
      legacy.cate2Id ?? legacy.douyuId ?? legacy.cate2Href ?? keyId,
    ).trim();
    // 老数据可能存的是 /category/2_86、虎牙完整 URL、抖音 1_1_1_xxx；
    // 这里统一换成当前接口 id，否则订阅能显示但取不到列表。
    const cate2Id = normalizeSubscriptionId(platform, rawId);
    if (!cate2Id) continue;
    const key = subscriptionKey(platform, cate2Id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      platform,
      cate1Id: item.cate1Id ?? "",
      cate1Name: item.cate1Name ?? "",
      cate2Id,
      cate2Name: item.cate2Name || cate2Id,
      createdAt: item.createdAt ?? 0,
    });
  }
  return out;
}

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const [raw, setRaw] = usePersistentState<Subscription[]>(STORAGE_KEYS.subscriptions, []);

  const subscriptions = useMemo(() => normalize(raw), [raw]);

  const isSubscribed = useCallback(
    (platform: LivePlatform, cate2Id: string) =>
      subscriptions.some((s) => s.platform === platform && s.cate2Id === cate2Id),
    [subscriptions],
  );

  const subscribe = useCallback(
    (input: SubscriptionInput) => {
      if (!input.cate2Id) return;
      setRaw((prev) => {
        const list = normalize(prev);
        const key = subscriptionKey(input.platform, input.cate2Id);
        if (list.some((s) => s.key === key)) return list;
        return [{ ...input, key, createdAt: Date.now() }, ...list];
      });
    },
    [setRaw],
  );

  const unsubscribe = useCallback(
    (platform: LivePlatform, cate2Id: string) => {
      setRaw((prev) =>
        normalize(prev).filter((s) => !(s.platform === platform && s.cate2Id === cate2Id)),
      );
    },
    [setRaw],
  );

  const toggle = useCallback(
    (input: SubscriptionInput) => {
      if (isSubscribed(input.platform, input.cate2Id)) {
        unsubscribe(input.platform, input.cate2Id);
      } else {
        subscribe(input);
      }
    },
    [isSubscribed, subscribe, unsubscribe],
  );

  const clear = useCallback(() => setRaw([]), [setRaw]);

  const byPlatform = useMemo(
    () =>
      PLATFORM_ORDER.map((platform) => ({
        platform,
        items: subscriptions.filter((s) => s.platform === platform),
      })).filter((group) => group.items.length > 0),
    [subscriptions],
  );

  const value = useMemo<SubscriptionContextValue>(
    () => ({
      subscriptions,
      byPlatform,
      isSubscribed,
      subscribe,
      unsubscribe,
      toggle,
      clear,
    }),
    [byPlatform, clear, isSubscribed, subscribe, subscriptions, toggle, unsubscribe],
  );

  return (
    <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>
  );
}

export function useSubscriptions(): SubscriptionContextValue {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) throw new Error("useSubscriptions 必须在 SubscriptionProvider 内使用");
  return ctx;
}
