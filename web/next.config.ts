import { execFileSync } from 'node:child_process'

import type { NextConfig } from 'next'

/** The built commit's UTC date and full hash, for the About panel's version line. Empty outside a
 *  git checkout, which the panel shows as no version at all rather than a made-up one. */
function builtCommit(): { date: string; commit: string } {
  try {
    const [date, commit] = execFileSync(
      'git',
      ['log', '-1', '--date=format-local:%Y.%m.%d', '--format=%cd %H'],
      { encoding: 'utf8', env: { ...process.env, TZ: 'UTC' }, stdio: ['ignore', 'pipe', 'ignore'] },
    )
      .trim()
      .split(' ')
    return { date: date ?? '', commit: commit ?? '' }
  } catch {
    return { date: '', commit: '' }
  }
}

const built = builtCommit()

// Next 16 dropped the built-in ESLint integration (no `eslint` config key exists any more,
// and none is installed here), so there is nothing to disable for the build.
const nextConfig: NextConfig = {
  output: 'export',
  env: {
    NEXT_PUBLIC_EARTHLAPSE_VERSION: built.date,
    NEXT_PUBLIC_EARTHLAPSE_COMMIT: built.commit,
  },
  // The QA export (`NEXT_PUBLIC_EARTHLAPSE_QA=1`, `scripts/qa/run.mjs`) goes to its own directory so
  // an ordinary build can never replace it with one lacking the QA hook: under `output: 'export'`
  // a non-default `distDir` is the export directory.
  ...(process.env.NEXT_PUBLIC_EARTHLAPSE_QA === '1' ? { distDir: 'out-qa' } : {}),
  images: {
    unoptimized: true,
  },
  reactStrictMode: true,
  // The dev-mode "N" badge overlaps the transport's back button in the immersive lens shell.
  devIndicators: false,
}

export default nextConfig
