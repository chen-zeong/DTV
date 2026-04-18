/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  // 说明：dev 下 React StrictMode 会导致 effect 重复执行（表现为同一 IPC invoke 多次）。
  // 这里先关闭以避免开发期“重复请求/空白页”干扰排查。
  reactStrictMode: false,
  experimental: {
    externalDir: true
  }
};

export default nextConfig;
