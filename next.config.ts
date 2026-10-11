import type { NextConfig } from "next";

// The pages may load scripts, styles, fonts and images from the app itself
// only, and may not be framed. They call forge-api and the login service from
// the browser; the login service's address is known only to the API, so
// connect-src cannot name it here.
const dev = process.env.NODE_ENV !== "production";
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self' http: https:${dev ? " ws:" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

// Standalone output: the image ships only .next/standalone, .next/static and public.
const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
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
