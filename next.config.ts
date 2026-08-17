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
};

export default nextConfig;
