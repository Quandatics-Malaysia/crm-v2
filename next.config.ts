import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["postgres"],
  allowedDevOrigins: ['192.168.68.100', '10.1.30.86', 'localhost'],
};

export default nextConfig;
