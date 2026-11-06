import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "bindings", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // 这两条来自 React Compiler 规则集，会对存量代码里大量"命令式副作用"
      //（播放器实例、订阅回调、滚动位置镜像）产生噪音；保留规则本身的价值，
      // 但在本项目里关闭，改用注释说明依赖。
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["vite.config.ts", "vitest.config.ts"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // 构建期脚本：Node ESM，允许 console / Buffer / TextEncoder
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // gen-emoticons.mjs 用 /^[\x00-\x7F]+$/ 过滤纯 ASCII 键，这里是有意为之
      "no-control-regex": "off",
    },
  },
);
