import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: ["192.168.*.*"],
  // cacheComponents: true, // Cloudflare(OpenNext)에서 "promise created by a request that has since ended" 오류가 나서 끈다
  // partialPrefetching: true, // cacheComponents 가 있어야 쓸 수 있는 설정
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
