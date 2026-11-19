import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@shopcontrol/shared'],
  poweredByHeader: false,
};

export default nextConfig;
