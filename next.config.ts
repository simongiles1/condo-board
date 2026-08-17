import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: [
    "pdf-parse",
    "pdfjs-dist",
    "googleapis",
    "pg",
    "nodemailer",
  ],
  // ESLint runs in dev/CI; skipping it during Docker build reduces peak memory.
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Type-checking this codebase OOMs Coolify's `next build` even at 3 GB heap.
  // Local `next build` still typechecks unless SKIP_TYPECHECK=1.
  typescript: {
    ignoreBuildErrors: process.env.SKIP_TYPECHECK === "1",
  },
  productionBrowserSourceMaps: false,
  experimental: {
    // Coolify build dies during "Collecting build traces" on this codebase.
    cpus: 1,
    webpackMemoryOptimizations: true,
    serverSourceMaps: false,
    enablePrerenderSourceMaps: false,
  },
  // pdfjs-dist is serverExternalPackages; standalone must ship the worker file.
  outputFileTracingIncludes: {
    "/*": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
  },
};

export default nextConfig;
