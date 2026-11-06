import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import wails from "@wailsio/runtime/plugins/vite";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

/**
 * 版本号唯一来源：build/config.yml 的 info.version。
 * 避免 frontend/package.json、appInfo.ts、构建配置三处各写一份（R-10）。
 */
function readAppVersion(): string {
  try {
    const file = fileURLToPath(new URL("../build/config.yml", import.meta.url));
    const yaml = readFileSync(file, "utf8");
    const infoBlock = yaml.split(/^info:/m)[1] ?? "";
    const match = infoBlock.match(/^\s+version:\s*["']?([^"'\s#]+)["']?/m);
    return match?.[1] ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(readAppVersion()),
  },
  server: {
    host: "127.0.0.1",
    // 由 `wails3 dev -port 2896` 注入；直接 `pnpm dev` 时回落到 2896
    port: Number(process.env.WAILS_VITE_PORT) || 2896,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    // Wails 官方插件：解析 `bindings` 目录下生成的 JS 绑定。
    // 当前阶段没有 Go 服务，bindings 目录为空，插件在缺文件时不会报错。
    wails("./bindings"),
  ],
  build: {
    // Wails 约定：嵌入 frontend/dist
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // P-01：把播放器/弹幕库拆成独立 chunk。
        // PlayerPage 已改为 lazy，这些 chunk 只在进入直播间时下载。
        manualChunks(id) {
          if (id.includes("node_modules/xgplayer")) return "player-xgplayer";
          if (id.includes("node_modules/@ironkinoko/danmaku")) return "player-danmaku";
          if (id.includes("node_modules/@heroui") || id.includes("node_modules/react-aria"))
            return "ui-vendor";
          return undefined;
        },
      },
    },
  },
});
