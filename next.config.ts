import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-hosted Docker image: emit a minimal standalone server bundle.
  output: "standalone",
  serverExternalPackages: ["postgres"],
  async rewrites() {
    return [
      // Entra redirects to /api/auth/callback/microsoft-entra-id (the registered
      // URI). Better Auth's generic-oauth handler lives at /oauth2/callback/...,
      // so forward there (query string — code & state — is preserved).
      {
        source: "/api/auth/callback/microsoft-entra-id",
        destination: "/api/auth/oauth2/callback/microsoft-entra-id",
      },
    ];
  },
};

export default nextConfig;
