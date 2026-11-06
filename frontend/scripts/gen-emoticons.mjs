/**
 * 生成 `src/lib/emoticons.data.ts`（表情名 → Unicode 表情的兜底表）。
 *
 * 数据来源：`emojibase-data` 的简体中文标注（CLDR 的中文本地化），
 * 只取"像表情名"的短词：名称 ≤4 字、标签 ≤3 字，并过滤纯数字/纯标点，
 * 避免把 `[100]`、`[？]` 这种正常方括号内容误判成表情。
 *
 * 用法（改了 emojibase-data 版本后重跑一次即可）：
 *   pnpm --dir frontend exec node scripts/gen-emoticons.mjs
 *
 * 生成物直接提交到仓库，运行时不再依赖 emojibase-data。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, "../node_modules/emojibase-data/zh/compact.json");
const target = resolve(here, "../src/lib/emoticons.data.ts");

const MAX_LABEL_LENGTH = 4;
const MAX_TAG_LENGTH = 3;
const MAX_NAMES_PER_EMOJI = 6;

/** 纯数字 / 纯 ASCII / 纯标点符号的键一律不要。 */
function isUsableKey(key) {
  if (!key) return false;
  const chars = [...key];
  if (chars.length > MAX_LABEL_LENGTH) return false;
  if (/^[\d\s]+$/.test(key)) return false;
  if (/^[\x00-\x7F]+$/.test(key)) return false; // 纯 ASCII 交给平台自己的键表
  if (/^[\p{P}\p{S}\s]+$/u.test(key)) return false;
  return true;
}

const data = JSON.parse(readFileSync(source, "utf8"));
const map = new Map();

for (const item of data) {
  const emoji = item.unicode;
  if (!emoji) continue;

  const names = [];
  if (item.label && [...item.label].length <= MAX_LABEL_LENGTH) names.push(item.label);
  for (const tag of item.tags ?? []) {
    if (tag && [...tag].length <= MAX_TAG_LENGTH) names.push(tag);
  }

  let taken = 0;
  for (const name of names) {
    if (taken >= MAX_NAMES_PER_EMOJI) break;
    const key = String(name).trim();
    if (!isUsableKey(key) || map.has(key)) continue;
    map.set(key, emoji);
    taken += 1;
  }
}

const sorted = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "zh"));
const lines = sorted.map(([key, emoji]) => `  ${JSON.stringify(key)}: ${JSON.stringify(emoji)},`);

const content = `/**
 * 由 scripts/gen-emoticons.mjs 自动生成，请勿手改。
 *
 * 来源：emojibase-data（MIT）的 zh/compact.json，即 Unicode CLDR 的简体中文标注。
 * 共 ${sorted.length} 条"中文名 → 表情"，作为平台专用表（lib/emoticons.ts 里的 EMOTICONS）
 * 之后的兜底：平台表优先，未命中再查这里。
 */
export const GENERIC_EMOTICONS: Record<string, string> = {
${lines.join("\n")}
};
`;

writeFileSync(target, content, "utf8");
console.log(`已生成 ${target}：${sorted.length} 条，${content.length} 字节`);
