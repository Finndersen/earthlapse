import type { NextConfig } from 'next'

// Next 16 dropped the built-in ESLint integration (no `eslint` config key exists any more,
// and none is installed here), so there is nothing to disable for the build.
const nextConfig: NextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  reactStrictMode: true,
}

export default nextConfig
