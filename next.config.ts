import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pdf-parse", "googleapis", "pg", "nodemailer"],
};

export default nextConfig;
