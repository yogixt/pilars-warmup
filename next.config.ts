import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The webhook route needs the raw body + Node crypto, so keep it on the Node runtime.
  serverExternalPackages: ["@libsql/client", "svix"],
};

export default nextConfig;
