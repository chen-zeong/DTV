import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wails from "@wailsio/runtime/plugins/vite";
import { fileURLToPath, URL } from "node:url";

// https://vitejs.dev/config/
export default defineConfig({
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
  },
});
