import type { NextConfig } from "next";

// Standalone output: the image ships only .next/standalone, .next/static and public.
const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // The Content-Security-Policy is set per request in proxy.ts: it names the login service, which only the API knows.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // The login callback's address carries a one-time code: never pass it on.
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
  // Forge's root filesystem is read-only; keep revalidated pages in memory instead of writing .next/server.
  experimental: { isrFlushToDisk: false },
  // Tailwind 4 runs as a Turbopack loader (Next's default for dev and build); with `--webpack`, add `@tailwindcss/postcss` instead.
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
