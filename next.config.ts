import type { NextConfig } from 'next';
const nextConfig: NextConfig = { devIndicators: false, distDir: process.env.LIGHTFLOW_BUILD_DIR || '.next' };
export default nextConfig;
