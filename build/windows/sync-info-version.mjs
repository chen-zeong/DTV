/**
 * 把 `build/config.yml` 里的 `info.version` 同步到 `build/windows/info.json`。
 *
 * 版本号的唯一来源是 `build/config.yml`（前端的 `vite.config.ts` 也从这里读，
 * 注入 `__APP_VERSION__`）。但 Windows 的 PE 版本资源是 `wails3 generate syso
 * -info windows/info.json` 静态读的，没有变量替换 —— 不自动同步就会出现
 * 「exe 属性里写 4.0.0、应用里显示 4.1.0」这种漂移。
 *
 * 由 `wails3 build`（build/windows/Taskfile.yml 的 `sync:version`）自动调用，
 * 也可以手动跑：
 *   node build/windows/sync-info-version.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(here, "../config.yml");
const infoPath = resolve(here, "info.json");

const yaml = readFileSync(configPath, "utf8");
const infoBlock = yaml.split(/^info:/m)[1] ?? "";
const match = infoBlock.match(/^\s+version:\s*["']?([^"'\s#]+)["']?/m);
const version = match?.[1];

if (!version) {
  console.error("[sync:version] 没能从 build/config.yml 的 info.version 里读到版本号");
  process.exit(1);
}
if (!/^\d+(\.\d+){1,3}$/.test(version)) {
  console.error(`[sync:version] 版本号 "${version}" 不是 PE 资源能接受的点分数字`);
  process.exit(1);
}

const raw = readFileSync(infoPath, "utf8");
const info = JSON.parse(raw);
info.fixed ??= {};
// fixed 块决定「详细信息」里的 File version / Product version（Explorer 优先读这里）
info.fixed.file_version = version;
info.fixed.product_version = version;
for (const table of Object.values(info.info ?? {})) {
  if (table && typeof table === "object") table.ProductVersion = version;
}

const next = `${JSON.stringify(info, null, "\t")}\n`;
if (next === raw) {
  console.log(`[sync:version] info.json 已是 ${version}，无需改动`);
  process.exit(0);
}

writeFileSync(infoPath, next, "utf8");
console.log(`[sync:version] windows/info.json → ${version}`);
