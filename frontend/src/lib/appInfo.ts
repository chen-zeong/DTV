/** 应用元信息。版本号由 vite.config.ts 从 build/config.yml 注入（R-10）。 */
declare const __APP_VERSION__: string;

export const APP_VERSION =
  typeof __APP_VERSION__ === "string" && __APP_VERSION__ ? __APP_VERSION__ : "4.1.0";
export const APP_NAME = "DTV";
