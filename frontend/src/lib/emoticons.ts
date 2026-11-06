/**
 * 弹幕里的"文字表情"还原。
 *
 * 各平台的弹幕正文里常常是 `[捂脸]` `[龇牙]` `[看]` 这样的中括号表情名，而不是
 * 图片地址。播放器如果直接画文本，用户看到的就是中括号 + 汉字。
 *
 * 解析分三级（命中即停）：
 *   1. `EMOTE_ASSETS`：B 站 / 抖音官方表情图（`scripts/gen-emotes.mjs` 生成，
 *      共 500+ 张，按平台优先匹配）。渲染成真正的表情图，观感和直播间一致；
 *   2. `EMOTICONS`：平台高频表情名 → Unicode 表情字符。覆盖官方表情包没收录的
 *      叫法（虎牙/斗鱼的习惯叫法、B 站的英文键等）；
 *   3. `GENERIC_EMOTICONS`：由 `scripts/gen-emoticons.mjs` 从 emojibase-data
 *      （CLDR 中文标注）生成的兜底表，约 4400 条，覆盖"看/笑/哭/赞"这类通用中文名。
 *
 * 三级都没命中的保持原样（比如用户真的在讨论 `[100]`），不会误伤正常方括号内容。
 */

import { GENERIC_EMOTICONS } from "./emoticons.data";
import { EMOTE_ASSETS, type EmoteSetName } from "./emotes.data";

/** 平台高频表情名 → Unicode 表情。英文键按小写匹配。 */
const EMOTICONS: Record<string, string> = {
  /* ------------------------------------------------------------------ 抖音高频 */
  捂脸: "🤦",
  龇牙: "😁",
  呲牙: "😁",
  大笑: "😄",
  微笑: "🙂",
  憨笑: "😄",
  哭笑: "😂",
  笑哭: "😂",
  滑稽: "🤪",
  嘘: "🤫",
  舔屏: "😋",
  打脸: "🤕",
  委屈: "🥺",
  无语: "😑",
  白眼: "🙄",
  汗: "😓",
  晕: "😵",
  睡: "😴",
  酷: "😎",
  害羞: "😊",
  吃惊: "😲",
  震惊: "😱",
  怒: "😠",
  可爱: "😊",
  思考: "🤔",
  灵机一动: "💡",
  灵光一闪: "✨",
  机智: "😏",
  调皮: "😜",
  吐舌: "😝",
  色: "😍",
  花痴: "😍",
  美的: "😍",
  心碎: "💔",
  难过: "😔",
  悲伤: "😭",
  疑问: "❓",
  问号: "❓",
  害怕: "😨",
  馋: "😋",
  想吃: "😋",
  干饭: "🍚",
  吃瓜: "🍉",
  抱抱: "🫂",
  摸头: "🫳",
  亲亲: "😘",
  飞吻: "😘",
  么么哒: "😘",
  啵啵: "😗",
  拜托: "🙏",
  鞠躬: "🙇",
  跪了: "🧎",
  摊手: "🤷",
  好的: "👌",
  比心: "🫰",
  送心: "💗",
  爱心: "❤️",
  心: "❤️",
  玫瑰: "🌹",
  鲜花: "💐",
  蛋糕: "🎂",
  咖啡: "☕",
  干杯: "🍻",
  啤酒: "🍺",
  红包: "🧧",
  福: "🧧",
  烟花: "🎆",
  火焰: "🔥",
  火: "🔥",
  星星: "⭐",
  月亮: "🌙",
  太阳: "☀️",
  赞: "👍",
  强: "👍",
  弱: "👎",
  鼓掌: "👏",
  撒花: "🎉",
  庆祝: "🎉",
  握手: "🤝",
  抱拳: "🙏",
  祈祷: "🙏",
  加油: "💪",
  拳头: "✊",
  耶: "✌️",
  胜利: "✌️",
  牛: "🐮",
  狗头: "🐶",
  猫: "🐱",
  猪: "🐷",
  熊猫: "🐼",
  鸡: "🐔",
  钱: "💰",
  礼物: "🎁",
  药: "💊",
  药丸: "💊",
  炸弹: "💣",
  火箭: "🚀",
  飞机: "✈️",
  唱歌: "🎤",
  听歌: "🎧",
  音乐: "🎵",
  拍照: "📷",
  手机: "📱",
  电脑: "💻",
  时间: "⏰",
  灯泡: "💡",

  /* ------------------------------------------- B 站 / 虎牙 / 斗鱼的英文或简写键 */
  doge: "🐶",
  tv_doge: "🐶",
  miaosha: "👏",
  妙啊: "👏",
  辣眼睛: "🙈",
  暗中观察: "👀",
  星星眼: "🤩",
  傲娇: "😤",
  生病: "🤒",
  惊喜: "🤩",
  紧张: "😰",
  抠鼻: "😒",
  偷笑: "😏",
  脱单: "🥳",
  嫌弃: "😒",
  打call: "📣",
  干杯啦: "🥂",
  支持: "💪",
  赞一个: "👍",
  奥利给: "💪",

  /* ------------------------------------- 抖音特有/CLDR 里说法不同的几个高频补充 */
  看: "👀",
  偷看: "🫣",
  坏笑: "😏",
  奸笑: "😏",
  流鼻血: "🤤",
  咧嘴笑: "😁",
  厉害: "👍",
  牛啊: "🐮",
  绝了: "🤙",
  冲: "🏃",
  泪目: "🥹",
  破防: "😭",
  社死: "🙈",
  比耶: "✌️",
  磕头: "🙇",
  卖萌: "🥺",
  摸鱼: "🐟",
  震惊脸: "😱",
  亲一个: "😘",
  熊猫头: "🐼",
  满眼问号: "❓",

  /* ------------------------------ 虎牙 / 斗鱼 / 快手习惯叫法（官方表情包未收录） */
  虎粮: "🌾",
  虎牙: "🐯",
  抖抖: "🤳",
  牛掰: "👍",
  我裂开了: "💔",
  裂开: "💔",
  真香: "😋",
  扎心: "💘",
  酸了: "🍋",
  我酸了: "🍋",
  好家伙: "😮",
  好活: "👏",
  好耶: "🥳",
  可以有: "👌",
  有内味了: "😏",
  爷青回: "🥲",
  下次一定: "🙂",
  这次一定: "✊",
  点赞三连: "👍",
  一键三连: "👍",
  干得漂亮: "👏",
  太强了: "💪",
  巨佬: "🧎",
  大佬: "😎",
  萌新: "😳",
  退群: "🏃",
  上号: "🎮",
  起飞: "🚀",
  芜湖: "🛫",
  下播: "🌙",
  来了: "🙋",
  上头: "🥴",
  离谱: "🤯",
  笑死: "😂",
  蚌埠住了: "😂",
  尬住: "😅",
  无语子: "😑",
  绝绝子: "🤩",
  有被吓到: "😱",
  慌的一批: "😰",
  麻了: "🫠",
  摆烂: "🛌",
  躺平: "🛌",
  点赞支持: "👍",
  榜一: "🥇",
  打赏: "💸",
  刷屏: "📢",
  别刷屏: "🤐",
  车库: "🚗",
  空调: "❄️",
  狗屎: "💩",
  喷水: "💦",
  结婚: "💍",
  生日: "🎂",
  巧克力: "🍫",
  奶茶: "🧋",
  饺子: "🥟",
  汤圆: "🍡",
  粽子: "🍙",
  西瓜: "🍉",
};

/** 平台专属图片表情集（目录名对齐生成脚本）。 */
const EMOTE_SETS: Record<string, EmoteSetName[]> = {
  bilibili: ["bilibili", "douyin"],
  douyin: ["douyin", "bilibili"],
  douyu: ["douyin", "bilibili"],
  huya: ["douyin", "bilibili"],
};

/**
 * 小写索引：官方表情包里有 `doge` / `OK` / `yyds` 这类大小写混排的键，
 * 弹幕里 `[DOGE]` 和 `[doge]` 都要认。启动时建一次，640 条量级可忽略。
 */
const EMOTE_INDEX: Record<EmoteSetName, Map<string, string>> = {
  bilibili: buildIndex("bilibili"),
  douyin: buildIndex("douyin"),
};

function buildIndex(set: EmoteSetName): Map<string, string> {
  const map = new Map<string, string>();
  for (const [name, src] of Object.entries(EMOTE_ASSETS[set] ?? {})) {
    const key = name.toLowerCase();
    if (!map.has(key)) map.set(key, src);
  }
  return map;
}

/** 图片表情预加载缓存：同一个表情图只 new Image() 一次。 */
const preloaded = new Set<string>();

/**
 * 预加载一张表情图。
 *
 * 弹幕节点是同步测量宽度的（库要拿 offsetWidth 算轨道），图片没加载完就会
 * 按 0 宽度排版。这里保证渲染时已经进了浏览器缓存；配合固定尺寸的 CSS，
 * 即使图片还在路上也不会把弹幕挤变形。
 */
export function preloadEmote(src: string): void {
  if (!src || preloaded.has(src) || typeof Image === "undefined") return;
  preloaded.add(src);
  const img = new Image();
  img.decoding = "async";
  img.src = src;
}

/** 按平台优先级查一张官方表情图，返回可放进 `<img src>` 的路径。 */
export function resolveEmoteImage(name: string, platform?: string): string | undefined {
  if (!name) return undefined;
  const key = name.toLowerCase();
  const sets = EMOTE_SETS[String(platform ?? "").toLowerCase()] ?? EMOTE_SETS.douyin;
  for (const set of sets) {
    const src = EMOTE_INDEX[set].get(key);
    if (src) return src;
  }
  return undefined;
}

/** 表情名 → Unicode 表情（官方表情图没收录时的兜底）。 */
export function resolveEmoticonEmoji(name: string): string | undefined {
  if (!name) return undefined;
  return EMOTICONS[name] ?? EMOTICONS[name.toLowerCase()] ?? GENERIC_EMOTICONS[name];
}

/** 解析出来的一段内容。 */
export type EmoticonPart =
  | { type: "text"; text: string }
  | { type: "emoji"; name: string; emoji: string }
  | { type: "image"; name: string; src: string };

/** 只匹配 1~16 个字符、不含空白与嵌套括号的表情名。 */
const EMOTICON_PATTERN = /\[([^[\]\s]{1,16})\]/g;

/** 单条弹幕里最多还原多少个表情，避免异常消息刷屏。 */
const MAX_PLACEHOLDERS = 12;

/**
 * 把一条弹幕正文切成「文本 / 表情图 / 表情字符」的片段。
 *
 * 返回的片段已经合并相邻文本，调用方可以直接 map 成节点，
 * 不会为每个汉字建一个 `<span>`。
 */
export function splitEmoticons(text: string, platform?: string): EmoticonPart[] {
  const source = String(text ?? "");
  if (!source || !source.includes("[")) {
    return source ? [{ type: "text", text: source }] : [];
  }

  const parts: EmoticonPart[] = [];
  const pushText = (value: string) => {
    if (!value) return;
    const last = parts[parts.length - 1];
    if (last && last.type === "text") last.text += value;
    else parts.push({ type: "text", text: value });
  };

  let cursor = 0;
  let replaced = 0;
  // matchAll 不会像 replace 那样重建整个字符串，长弹幕里更省
  for (const match of source.matchAll(EMOTICON_PATTERN)) {
    const index = match.index ?? 0;
    pushText(source.slice(cursor, index));
    cursor = index + match[0].length;

    const name = match[1];
    if (replaced >= MAX_PLACEHOLDERS) {
      pushText(match[0]);
      continue;
    }

    const src = resolveEmoteImage(name, platform);
    if (src) {
      replaced += 1;
      preloadEmote(src);
      parts.push({ type: "image", name, src });
      continue;
    }

    const emoji = resolveEmoticonEmoji(name);
    if (emoji) {
      replaced += 1;
      parts.push({ type: "emoji", name, emoji });
      continue;
    }

    // 不认识的中括号原样保留（例如 `[100]`、`[笑死我了但是我不说]`）
    pushText(match[0]);
  }
  pushText(source.slice(cursor));

  return parts;
}
