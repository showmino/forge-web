import type { NextConfig } from "next";

// Standalone output: the image ships only .next/standalone, .next/static and public.
const nextConfig: NextConfig = {
  output: "standalone",
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
