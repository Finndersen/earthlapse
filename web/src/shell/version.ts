const REPO_URL = 'https://github.com/Finndersen/earthlapse'

export interface SiteVersion {
  /** The built commit's UTC date and short hash, e.g. `2026.09.24 · 9500113`. */
  label: string
  href: string
}

/** The version `next.config.ts` bakes in from the built commit, or null when the build had none. */
export function siteVersion(date: string | undefined, commit: string | undefined): SiteVersion | null {
  if (!date || !commit) return null
  return { label: `${date} · ${commit.slice(0, 7)}`, href: `${REPO_URL}/commit/${commit}` }
}
