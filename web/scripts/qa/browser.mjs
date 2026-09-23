#!/usr/bin/env node
/**
 * Which Chromium the harness launches. A preinstalled Chromium is launched by path rather than
 * through Playwright's own revision lookup, which only finds the exact build this Playwright
 * version was released with. In order:
 *
 * 1. `QA_CHROMIUM` (or the older `QA_CHROMIUM_PATH`), which must exist;
 * 2. `$PLAYWRIGHT_BROWSERS_PATH/chromium` (default `/opt/pw-browsers`), the cloud image's link;
 * 3. the newest `chromium-<rev>/chrome-linux*` build under that same directory;
 * 4. Playwright's own download for this version (`executablePath: undefined`).
 *
 * Run directly, it prints the resolved path and exits 1 when there is none (`scripts/setup.sh
 * browser`).
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_BROWSERS_PATH = '/opt/pw-browsers'

function isFile(file) {
  try {
    return statSync(file).isFile()
  } catch {
    return false
  }
}

function newestBuildUnder(root) {
  let entries
  try {
    entries = readdirSync(root)
  } catch {
    return null
  }
  const builds = entries
    .map((name) => ({ name, rev: /^chromium-(\d+)$/.exec(name)?.[1] }))
    .filter((entry) => entry.rev !== undefined)
    .sort((a, b) => Number(b.rev) - Number(a.rev))
  for (const { name } of builds) {
    for (const platformDir of ['chrome-linux64', 'chrome-linux']) {
      const binary = path.join(root, name, platformDir, 'chrome')
      if (isFile(binary)) return binary
    }
  }
  return null
}

/**
 * @returns {Promise<{ executablePath: string | undefined, source: string } | null>} `null` when no
 *   Chromium is available at all.
 */
export async function resolveChromium() {
  const override = process.env.QA_CHROMIUM || process.env.QA_CHROMIUM_PATH
  if (override) {
    if (!isFile(override)) throw new Error(`QA_CHROMIUM=${override} is not a file`)
    return { executablePath: override, source: 'QA_CHROMIUM' }
  }
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || DEFAULT_BROWSERS_PATH
  const linked = path.join(root, 'chromium')
  if (isFile(linked)) return { executablePath: linked, source: linked }
  const newest = newestBuildUnder(root)
  if (newest !== null) return { executablePath: newest, source: newest }
  try {
    const { chromium } = await import('playwright')
    if (existsSync(chromium.executablePath())) return { executablePath: undefined, source: 'playwright download' }
  } catch {
    // no playwright installed, so no download of its own either
  }
  return null
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const resolved = await resolveChromium().catch((error) => {
    console.error(String(error.message ?? error))
    process.exit(1)
  })
  if (resolved === null) {
    console.error('no Chromium found (QA_CHROMIUM, $PLAYWRIGHT_BROWSERS_PATH, or a Playwright download)')
    process.exit(1)
  }
  console.log(resolved.executablePath ?? resolved.source)
}
