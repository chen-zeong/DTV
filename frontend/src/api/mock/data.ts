import type {
  Category,
  CategoryGroup,
  DanmakuMessage,
  LivePlatform,
  SearchHit,
  StreamInfo,
  Streamer,
} from "../types";

/* =============================================================================
 * 假数据生成器
 *
 * 目标：不依赖任何外部图片/接口，就能让 UI 看起来像真实产品。
 * 所有"随机"都由字符串种子决定 → 同一房间号每次渲染结果一致（不会闪）。
 * 接上 Go 后端后，本文件整体删除即可，UI 无需改动。
 * ========================================================================== */

/** FNV-1a 字符串哈希 */
function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32：给定种子返回 [0,1) 的确定性随机序列 */
function rng(seed: string): () => number {
  let a = hashString(seed);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(list: readonly T[], r: number): T {
  return list[Math.floor(r * list.length) % list.length]!;
}

/** 生成一张渐变封面（SVG data URI） */
export function makeCover(seed: string): string {
  const r = rng(`cover:${seed}`);
  const hue = Math.floor(r() * 360);
  const hue2 = (hue + 40 + Math.floor(r() * 60)) % 360;
  const x1 = Math.floor(r() * 60);
  const y1 = Math.floor(r() * 60);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 480 270">
<defs><linearGradient id="g" x1="${x1}%" y1="${y1}%" x2="100%" y2="100%">
<stop offset="0%" stop-color="hsl(${hue} 55% 46%)"/><stop offset="100%" stop-color="hsl(${hue2} 60% 22%)"/>
</linearGradient></defs>
<rect width="480" height="270" fill="url(#g)"/>
<circle cx="${Math.floor(r() * 480)}" cy="${Math.floor(r() * 270)}" r="${90 + Math.floor(r() * 90)}" fill="rgba(255,255,255,0.08)"/>
<circle cx="${Math.floor(r() * 480)}" cy="${Math.floor(r() * 270)}" r="${40 + Math.floor(r() * 60)}" fill="rgba(0,0,0,0.14)"/>
<rect width="480" height="270" fill="rgba(0,0,0,0.18)"/>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** 生成头像（首字 + 圆形色块） */
export function makeAvatar(seed: string, label: string): string {
  const r = rng(`avatar:${seed}`);
  const hue = Math.floor(r() * 360);
  const ch = (label || "?").slice(0, 1);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
<rect width="96" height="96" rx="48" fill="hsl(${hue} 60% 42%)"/>
<text x="48" y="62" font-size="44" font-family="OPPO Sans, Microsoft YaHei, sans-serif" font-weight="700"
 fill="rgba(255,255,255,0.92)" text-anchor="middle">${ch}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/* ------------------------------------------------------------------ 分区数据 */

const GAME_NAMES = [
  "英雄联盟",
  "王者荣耀",
  "和平精英",
  "CS2",
  "DOTA2",
  "永劫无间",
  "原神",
  "魔兽世界",
  "地下城与勇士",
  "穿越火线",
  "无畏契约",
  "星际争霸",
];

const ENTERTAINMENT_NAMES = [
  "主机游戏",
  "热门手游",
  "娱乐天地",
  "户外",
  "音乐",
  "舞蹈",
  "二次元",
  "电台",
  "美食",
  "旅行",
];

const PLATFORM_CATEGORY_OVERRIDE: Partial<Record<LivePlatform, string[]>> = {
  douyin: ["推荐", "游戏", "聊天", "户外", "音乐", "美食", "旅行", "穿搭"],
  bilibili: ["虚拟主播", "网游", "手游", "单机", "娱乐", "电台", "学习", "生活"],
};

export const CATEGORY_TREE: Record<LivePlatform, CategoryGroup[]> = {
  douyu: [
    {
      id: "hot",
      name: "热门游戏",
      categories: GAME_NAMES.slice(0, 6).map((name, i) => ({ id: `hot-${i}`, name })),
    },
    {
      id: "ent",
      name: "娱乐推荐",
      categories: ENTERTAINMENT_NAMES.slice(0, 6).map((name, i) => ({ id: `ent-${i}`, name })),
    },
  ],
  huya: [
    {
      id: "hot",
      name: "热门游戏",
      categories: GAME_NAMES.slice(3, 9).map((name, i) => ({ id: `hot-${i}`, name })),
    },
    {
      id: "ent",
      name: "娱乐推荐",
      categories: ENTERTAINMENT_NAMES.slice(2, 8).map((name, i) => ({ id: `ent-${i}`, name })),
    },
  ],
  douyin: [
    {
      id: "rec",
      name: "推荐分区",
      categories: (PLATFORM_CATEGORY_OVERRIDE.douyin ?? []).map((name, i) => ({
        id: `rec-${i}`,
        name,
      })),
    },
  ],
  bilibili: [
    {
      id: "rec",
      name: "推荐分区",
      categories: (PLATFORM_CATEGORY_OVERRIDE.bilibili ?? []).map((name, i) => ({
        id: `rec-${i}`,
        name,
      })),
    },
  ],
};

/* ------------------------------------------------------------ 三级分区（斗鱼） */

/** 假的三级分区：斗鱼真实接口里"英雄联盟"下会有"赛事直播"之类的子分类 */
export const SUB_CATEGORY_TREE: Partial<Record<LivePlatform, Record<string, Category[]>>> = {
  douyu: {
    "hot-0": [
      { id: "sub-0-0", name: "全部赛事" },
      { id: "sub-0-1", name: "LPL 春季赛" },
      { id: "sub-0-2", name: "主播排位" },
      { id: "sub-0-3", name: "教学复盘" },
    ],
    "hot-1": [
      { id: "sub-1-0", name: "KPL 职业赛" },
      { id: "sub-1-1", name: "巅峰对决" },
    ],
  },
};

/* ---------------------------------------------------------------- 主播数据 */

const PREFIX = ["小", "大", "阿", "老", "萌", "神", "国民", "深夜", "暴躁", "温柔"];
const SUFFIX = [
  "橘子",
  "可乐",
  "西瓜",
  "柚子",
  "团子",
  "鸽王",
  "八两",
  "十三",
  "小鹿",
  "阿蛮",
  "清欢",
  "白给",
];
const TITLE_TAILS = [
  "冲分上分中，带躺～",
  "今天必赢，不来可惜",
  "新赛季第一天，冲榜",
  "晚上八点抽奖，进来坐坐",
  "随便聊聊，欢迎点歌",
  "技术流教学，问就答",
  "国服第一，来战",
  "进来就是兄弟",
  "开黑带飞，缺人速来",
  "深夜陪伴，说说话",
];

function makeNickname(r: () => number): string {
  return `${pick(PREFIX, r())}${pick(SUFFIX, r())}${Math.floor(r() * 90) + 10}`;
}

/** 生成某一分区下的主播列表 */
export function makeStreamers(
  platform: LivePlatform,
  categoryId: string,
  count: number,
  offset = 0,
): Streamer[] {
  const out: Streamer[] = [];
  const groups = CATEGORY_TREE[platform];
  const allCats = groups.flatMap((g) => g.categories);
  const matched = allCats.find((c) => c.id === categoryId);

  for (let i = 0; i < count; i++) {
    // offset 参与种子，保证第 2/3 页和第一页内容不同（演练无限滚动）
    const index = offset + i;
    const seed = `${platform}:${categoryId}:${index}`;
    const r = rng(seed);
    const nickname = makeNickname(r);
    const viewers = Math.floor(r() * 240000) + 120;
    out.push({
      id: `${platform}${Math.floor(r() * 9000000) + 1000000}`,
      platform,
      nickname,
      title: pick(TITLE_TAILS, r()),
      cover: makeCover(seed),
      avatar: makeAvatar(seed, nickname),
      viewers,
      categoryName: matched?.name ?? pick(allCats, r()).name,
      isLive: r() > 0.12,
    });
  }
  return out.sort((a, b) => b.viewers - a.viewers);
}

/** 搜索（假实现：从该平台全部主播里模糊匹配） */
export function makeSearchHits(platform: LivePlatform, keyword: string): SearchHit[] {
  const kw = keyword.trim();
  if (!kw) return [];
  const all = CATEGORY_TREE[platform].flatMap((g) => g.categories);
  const pool = all.flatMap((c) => makeStreamers(platform, c.id, 6));
  return pool
    .filter((s) => s.nickname.includes(kw) || s.title.includes(kw) || s.id.includes(kw))
    .slice(0, 8)
    .map((s) => ({
      id: s.id,
      nickname: s.nickname,
      title: s.title,
      avatar: s.avatar,
      isLive: s.isLive,
    }));
}

/* -------------------------------------------------------------- 直播流信息 */

/** 公开测试流，用于骨架阶段验证播放器链路 */
const TEST_HLS = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";
const TEST_HLS_ALT = "https://test-streams.mux.dev/pts_shift/master.m3u8";
const TEST_FLV = "https://mvdirona.com/jrjones/static/test.flv";

const LINE_LABEL: Partial<Record<LivePlatform, string[]>> = {
  douyu: ["线路一", "线路二", "线路三", "线路四"],
  huya: ["虎牙一", "虎牙二", "虎牙三"],
};

export function makeStreamInfo(platform: LivePlatform, roomId: string): StreamInfo {
  const r = rng(`stream:${platform}:${roomId}`);
  const nickname = makeNickname(r);
  const lineLabels = LINE_LABEL[platform] ?? [];

  const variants = [
    { id: "source", label: "原画", url: TEST_HLS, format: "hls" as const },
    { id: "high", label: "高清", url: TEST_HLS_ALT, format: "hls" as const },
    { id: "standard", label: "标清", url: TEST_FLV, format: "flv" as const },
  ];

  return {
    roomId,
    platform,
    title: `${pick(TITLE_TAILS, r())}｜房间 ${roomId}`,
    nickname,
    avatar: makeAvatar(`stream:${roomId}`, nickname),
    isLive: true,
    variants,
    lines: lineLabels.map((label, i) => ({ id: `${platform}-line-${i}`, label })),
  };
}

/* ------------------------------------------------------------------ 弹幕池 */

const DANMAKU_TEXT = [
  "主播牛啊",
  "这波操作可以",
  "来了来了",
  "第一次来，关注了",
  "666666",
  "哈哈哈哈哈",
  "下饭了兄弟",
  "这波不亏",
  "蹲一个抽奖",
  "刚来，讲什么呢",
  "晚安，明天见",
  "这操作我能吹一年",
  "打得好，赏一个",
  "别送了别送了",
  "主播声音好听",
  "有没有一起开黑的",
  "建议换个英雄",
  "经典失误",
  "这枪法绝了",
  "优化一下画质吧",
  // 带文字表情的几条：脱离 Go 侧调试 UI 时用来检查表情还原
  // （`[看]` / `[捂脸]` 走抖音官方表情图，`[花痴]` 走 Unicode 兜底）
  "主播牛啊[赞][赞]",
  "这波我给[看]了",
  "哈哈哈[捂脸][呲牙]",
  "别骂了别骂了[花痴]",
];

const DANMAKU_GIFT = ["送出一个火箭", "送出一个飞机", "打赏了 10 个荧光棒", "加入粉丝团"];

export function makeDanmaku(seed: string): DanmakuMessage {
  const r = rng(seed);
  const roll = r();
  const kind: DanmakuMessage["kind"] = roll > 0.93 ? "gift" : roll > 0.88 ? "enter" : "chat";
  const nickname = kind === "enter" ? makeNickname(r) : makeNickname(r);
  const content =
    kind === "gift" ? pick(DANMAKU_GIFT, r()) : kind === "enter" ? "进入直播间" : pick(DANMAKU_TEXT, r());

  return {
    id: seed,
    nickname,
    content,
    level: Math.floor(r() * 40),
    kind,
    at: Date.now(),
  };
}

/** 定时发弹幕的假订阅器 */
export function createDanmakuTicker(
  seed: string,
  onMessage: (msg: DanmakuMessage) => void,
  intervalMs = 700,
): () => void {
  let n = 0;
  let alive = true;
  const timer = window.setInterval(() => {
    if (!alive) return;
    // 偶尔一次发 2 条，模拟弹幕密集
    onMessage(makeDanmaku(`${seed}:${Date.now()}:${n++}`));
    if (Math.random() > 0.75) {
      onMessage(makeDanmaku(`${seed}:${Date.now()}:${n++}`));
    }
  }, intervalMs);

  return () => {
    alive = false;
    window.clearInterval(timer);
  };
}
