import type { NextConfig } from 'next'

// Next 16 dropped the built-in ESLint integration (no `eslint` config key exists any more,
// and none is installed here), so there is nothing to disable for the build.
const nextConfig: NextConfig = {
  output: 'export',
  // The QA export (`NEXT_PUBLIC_EARTHTIME_QA=1`, `scripts/qa/run.mjs`) goes to its own directory so
  // an ordinary build can never replace it with one lacking the QA hook: under `output: 'export'`
  // a non-default `distDir` is the export directory.
  ...(process.env.NEXT_PUBLIC_EARTHTIME_QA === '1' ? { distDir: 'out-qa' } : {}),
  images: {
    unoptimized: true,
  },
  reactStrictMode: true,
  // The dev-mode "N" badge overlaps the transport's back button in the immersive lens shell.
  devIndicators: false,
}

export default nextConfig
