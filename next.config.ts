import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-hosted Docker image: emit a minimal standalone server bundle.
  output: "standalone",
  serverExternalPackages: ["postgres"],
  // No OAuth rewrite needed: the Microsoft provider's redirectURI points
  // directly at Better Auth's generic-oauth handler
  // (/api/auth/oauth2/callback/microsoft-entra-id), which is the exact URI to
  // register in the Azure app registration. See lib/auth.ts.
};

export default nextConfig;
