import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the MVP tiny — API-first, no experimental flags needed.
};

export default nextConfig;

import('@opennextjs/cloudflare').then(m => m.initOpenNextCloudflareForDev());
