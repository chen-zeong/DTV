/**
 * 生成弹幕图片表情资源：`public/emotes/**` + `src/lib/emotes.data.ts`。
 *
 * 数据来源：npm 包 `bilicon`（MIT，gweesin/bilicon）。它把 B 站 / 抖音官方表情
 * 都内联成了 iconify 格式的 base64 图片，这里把图片拆成独立文件，并生成
 * "表情名 → 静态资源路径" 的映射表。
 *
 * 为什么拆成文件而不是内联进 JS：
 *   546 个表情全部内联会让首屏 chunk 多出 6MB+ base64；拆成独立 png 后
 *   浏览器/WebView 只在弹幕里真的出现某个表情时才按需加载，且天然可缓存。
 *
 * 版权说明：`bilicon` 的 MIT 只覆盖它自己的代码；表情美术资源版权归
 * 哔哩哔哩 / 抖音所有。本项目只在本地播放器内做"弹幕文字还原成表情"，
 * 不重新分发这些图片用于其它用途。如果不希望携带它们，删掉 public/emotes
 * 再重跑一次本脚本（只保留映射表为空）即可，运行时自动回退到 Unicode 表情。
 *
 * 用法（升级 bilicon 后重跑一次即可）：
 *   pnpm --dir frontend exec node scripts/gen-emotes.mjs
 *
 * 生成物直接提交到仓库，运行时不再依赖 bilicon。
 */
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { biliIconifyJSON, douyinIconifyJSON } from "bilicon";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, "../public/emotes");
const targetFile = resolve(here, "../src/lib/emotes.data.ts");

/** 集合名 → 资源目录名。目录名直接对齐前端的 LivePlatform，取用时不需再映射。 */
const COLLECTIONS = [
  ["bilibili", biliIconifyJSON],
  ["douyin", douyinIconifyJSON],
];

/** iconify 的图标体形如 `<image ... xlink:href="data:image/png;base64,...."/>`。 */
const DATA_URI = /data:image\/([a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/i;

const MIME_EXT = {
  png: "png",
  webp: "webp",
  gif: "gif",
  jpeg: "jpg",
  jpg: "jpg",
};

/**
 * bilicon 里的 data URI 声明的 mime 并不可靠（抖音那批声明 `image/png`，
 * 实际是 WebP）。扩展名必须跟真实格式一致，否则拷进 `<img>` 后
 * 各内核表现不一，也要挨"内容与扩展名不符"的告警。
 */
function sniffExt(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    return "png";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("latin1") === "RIFF" &&
    buffer.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "webp";
  }
  if (buffer.length >= 6 && buffer.subarray(0, 3).toString("latin1") === "GIF") {
    return "gif";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpg";
  }
  return undefined;
}

/** FNV-1a 32bit：同一个表情名永远得到同一个文件名，重新生成不会整树改名。 */
function hashName(name) {
  const bytes = new TextEncoder().encode(name);
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

async function cleanDir(dir) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(
    entries.map((entry) => rm(join(dir, entry.name), { recursive: true, force: true })),
  );
}

const tables = {};
const counts = {};

for (const [name, collection] of COLLECTIONS) {
  const dir = join(publicDir, name);
  await cleanDir(dir);
  await mkdir(dir, { recursive: true });

  const table = {};
  const used = new Map();
  const icons = collection?.icons ?? {};
  const names = Object.keys(icons).sort((a, b) => a.localeCompare(b, "zh"));

  for (const emoteName of names) {
    const body = String(icons[emoteName]?.body ?? "");
    const match = DATA_URI.exec(body);
    if (!match) continue;
    const buffer = Buffer.from(match[2], "base64");
    const ext = sniffExt(buffer) ?? MIME_EXT[match[1].toLowerCase()];
    if (!ext) continue;

    // 极少数表情名可能撞哈希，撞了就加序号后缀，保证一一对应
    let file = hashName(emoteName);
    while (used.has(file) && used.get(file) !== emoteName) {
      file = `${hashName(emoteName)}-${used.size}`;
    }
    used.set(file, emoteName);

    await writeFile(join(dir, `${file}.${ext}`), buffer);
    table[emoteName] = `/emotes/${name}/${file}.${ext}`;
  }

  tables[name] = table;
  counts[name] = Object.keys(table).length;
}

const lines = [];
lines.push("/**");
lines.push(" * 弹幕图片表情的静态资源表（表情名 → public 下的路径）。");
lines.push(" *");
lines.push(" * 由 `scripts/gen-emotes.mjs` 生成，请勿手改。");
lines.push(" * 数据源：`bilicon`（MIT）里的 B 站 / 抖音官方表情。");
lines.push(" * 表情美术资源版权归对应平台所有，仅用于本地播放器内的弹幕还原。");
lines.push(" *");
for (const [name, count] of Object.entries(counts)) {
  lines.push(` *   ${name}: ${count} 个`);
}
lines.push(" */");
lines.push("");
lines.push('/** 表情资源所属平台（对齐 LivePlatform 的取名）。 */');
lines.push('export type EmoteSetName = "bilibili" | "douyin";');
lines.push("");
lines.push("/** 表情名 → 静态资源路径。同名表情不同平台是两张不同的图。 */");
lines.push("export const EMOTE_ASSETS: Record<EmoteSetName, Record<string, string>> = {");
for (const [name] of COLLECTIONS) {
  lines.push(`  ${name}: {`);
  for (const [key, value] of Object.entries(tables[name])) {
    lines.push(`    ${JSON.stringify(key)}: ${JSON.stringify(value)},`);
  }
  lines.push("  },");
}
lines.push("};");
lines.push("");
lines.push("/** 每个平台收录的表情数量（调试 / 文档用）。 */");
lines.push(`export const EMOTE_COUNTS: Record<EmoteSetName, number> = ${JSON.stringify(counts)};`);
lines.push("");

await writeFile(targetFile, lines.join("\n"), "utf8");

console.log(
  `[gen-emotes] ${Object.entries(counts)
    .map(([name, count]) => `${name}=${count}`)
    .join(" ")} → ${targetFile}`,
);
