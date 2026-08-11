import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  productionBrowserSourceMaps: false,
  outputFileTracingRoot: path.join(__dirname, "../../"),
  serverExternalPackages: ["postgres"],
  allowedDevOrigins: ['192.168.68.100', '10.1.30.86', 'localhost'],
};

export default nextConfig;
