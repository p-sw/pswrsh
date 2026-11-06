import type { NextConfig } from "next";

const gatewayPort = process.env.PSWRSH_GATEWAY_PORT ?? "3101";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [
      { source: "/ws", destination: `http://127.0.0.1:${gatewayPort}/ws` },
      { source: "/api/sessions", destination: `http://127.0.0.1:${gatewayPort}/api/sessions` },
      { source: "/api/sessions/:path*", destination: `http://127.0.0.1:${gatewayPort}/api/sessions/:path*` },
    ];
  },
};

export default nextConfig;
