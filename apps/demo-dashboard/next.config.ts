import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow Node.js APIs in API routes (needed for simulate route's child_process)
  serverExternalPackages: [],
};

export default nextConfig;
