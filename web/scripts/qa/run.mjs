#!/usr/bin/env node
/**
 * Visual-QA harness runner. One `next build` (unless `--dev`/`--no-build`), one static server,
 * one browser, one page load — every shot drives the already-loaded page through
 * `window.__earthtime` (`web/src/store/devHook.ts`) rather than reloading. See `README.md` for
 * the full contract and CLI reference; `--help` prints the same summary.
 */

import { spawnSync } from 'node:child_process'
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

import { buildContactSheet } from './contactSheet.mjs'
import { makeHook, rafTicks } from './hook.mjs'
import { startStaticServer } from './server.mjs'
import { ONBOARDING_TOUR_SELECTOR } from './selectors.mjs'
import shotList from './shots.mjs'
import smokeShotNames from './smokeShots.mjs'
import { waitForApproxUnfoldProgress, waitForSceneCrossfadeSettle } from './timeouts.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = path.resolve(__dirname, '../..')
const QA_ROOT = __dirname
const OUT_ROOT = path.join(QA_ROOT, 'out')
const NEXT_BIN = path.join(WEB_ROOT, 'node_modules/.bin/next')
const DEV_SERVER_URL = 'http://localhost:3000'
const DEFAULT_VIEWPORT = { width: 1440, height: 900 }

const HELP = `
Visual-QA harness for the Earthlapse web app.

Usage:
  pnpm qa [options]              build + serve + run the full (or filtered) shot list
  pnpm qa:serve                  build (unless --no-build) + serve out/, print the URL, and wait

Options:
  --dev                    attach to an already-running \`next dev\` on :3000 instead of building
  --no-build                skip \`next build\`, reuse the existing scripts/qa's built out/ export
  --serve-only              build (unless --no-build) + serve, then idle until Ctrl+C (no shots run)
  --shots <a,b,c*>           comma-separated shot names/globs (matched against each shot's \`name\`)
  --smoke                    run only \`smokeShots.mjs\`'s named subset (ignored if --shots is also given)
  --no-screenshots           skip per-shot PNGs and the contact sheet — measurements/assertions still run
  --viewport <WxH>           override every shot's own viewport
  --reduced-motion <mode>    'reduce' (default) or 'no-preference'
  --port <n>                 static server port (default: an ephemeral free port)
  --out <name>               run folder name under scripts/qa/out/ (default: a timestamp)
  --help                     print this message
`

function parseArgs(rawArgv) {
  // `pnpm run qa -- --smoke` (the form this README/preflight.sh both use) passes the literal
  // `--` straight through on this pnpm version, unlike npm's own `--` separator, which strips
  // it — strip it here too so `pnpm qa -- --foo` and `node scripts/qa/run.mjs --foo` parse the
  // same flags. Only a *leading* `--` is special-cased: nothing here takes a literal `--` as an
  // option's own value, so one appearing later is a real typo, not this pass-through quirk.
  const argv = rawArgv[0] === '--' ? rawArgv.slice(1) : rawArgv
  const args = {
    dev: false,
    noBuild: false,
    serveOnly: false,
    shots: null,
    smoke: false,
    noScreenshots: false,
    viewport: null,
    reducedMotion: 'reduce',
    port: 0,
    out: null,
    help: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dev') args.dev = true
    else if (arg === '--no-build') args.noBuild = true
    else if (arg === '--serve-only') args.serveOnly = true
    else if (arg === '--help' || arg === '-h') args.help = true
    else if (arg === '--shots') args.shots = argv[(i += 1)].split(',').map((s) => s.trim())
    else if (arg === '--smoke') args.smoke = true
    else if (arg === '--no-screenshots') args.noScreenshots = true
    else if (arg === '--viewport') args.viewport = parseViewport(argv[(i += 1)])
    else if (arg === '--reduced-motion') args.reducedMotion = argv[(i += 1)]
    else if (arg === '--port') args.port = Number(argv[(i += 1)])
    else if (arg === '--out') args.out = argv[(i += 1)]
    else throw new Error(`unknown argument: ${arg}`)
  }
  // `--smoke` picks smokeShots.mjs's own list by exact name, unless the caller already narrowed
  // with --shots. A name renamed out from under it in shots.mjs surfaces as selectShots' own
  // "matched no shot" warning (or its "matched nothing" error if every name goes stale at once).
  if (args.smoke && args.shots === null) args.shots = smokeShotNames
  return args
}

function parseViewport(spec) {
  const match = /^(\d+)x(\d+)$/.exec(spec)
  if (match === null) throw new Error(`--viewport expects WxH, got "${spec}"`)
  return { width: Number(match[1]), height: Number(match[2]) }
}

/** `*` as a wildcard, otherwise an exact match. */
function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}

function selectShots(all, filters) {
  if (filters === null) return all
  const patterns = filters.map((filter) => ({ filter, regex: globToRegExp(filter) }))
  const selected = all.filter((shot) => patterns.some((p) => p.regex.test(shot.name)))
  if (selected.length === 0) throw new Error(`--shots matched nothing (filters: ${filters.join(', ')})`)
  const unmatched = patterns.filter((p) => !all.some((shot) => p.regex.test(shot.name))).map((p) => p.filter)
  if (unmatched.length > 0) console.warn(`warning: these --shots filters matched no shot: ${unmatched.join(', ')}`)
  return selected
}

function getPath(obj, dotPath) {
  return dotPath.split('.').reduce((value, key) => (value === undefined || value === null ? undefined : value[key]), obj)
}

function runNextBuild() {
  console.log('Building static export (NEXT_PUBLIC_EARTHTIME_QA=1 next build)…')
  const result = spawnSync(NEXT_BIN, ['build'], {
    cwd: WEB_ROOT,
    env: { ...process.env, NEXT_PUBLIC_EARTHTIME_QA: '1' },
    stdio: 'inherit',
  })
  if (result.status !== 0) throw new Error(`next build failed (exit ${result.status})`)
}

/** `Globe.tsx`'s own defaults for state this harness can't reload away — a fresh mount would
 *  start here, and the legend's toggles are session-sticky (nothing in the app resets them but a
 *  click), so a shot that doesn't mention one inherits whatever an *earlier* shot left it at
 *  unless every shot that expands the globe re-asserts the full baseline, merged with its own
 *  overrides, below. */
const DEFAULT_LAYER_TOGGLES = { 'human-civilisation': true }

/**
 * Closes whatever HUD layer chart a previous shot left expanded (`useTimeStore`'s
 * `expandedChartLayerId`, no `devHook.ts` setter of its own since it is per-layer rather than a
 * fixed field `setT`-like calls can target) by clicking its real "Collapse … chart" button — the
 * same "drive the accessible control a person would" approach `setGlobeViewMode`/`setLayerToggle`
 * already use. At most one such button ever exists, since only one chart can be expanded at a
 * time (`Experience.tsx`'s `expandedChartLayerId`). Left open, it eats into the layout every
 * later shot measures — this is exactly how `timeline-pip-thumbnail-hover` flaked when the shot
 * before it left population's chart open: the checkpoint pip it hovers rendered squeezed to a
 * fraction of its real height. Settles with the same `ready()` + `rafTicks` pair every other
 * DOM-driven setter in this module uses before handing back to the shot, since collapsing the
 * chart reflows the whole HUD column beneath it and a hover immediately afterwards can otherwise
 * land mid-reflow.
 * @param {import('playwright').Page} page
 * @param {ReturnType<typeof import('./hook.mjs').makeHook>} hook
 */
async function closeExpandedChart(page, hook) {
  const collapseButton = page.getByRole('button', { name: /^Collapse .+ chart$/ })
  if ((await collapseButton.count()) === 0) return
  await collapseButton.first().click()
  await hook.ready()
  await rafTicks(page, 2)
}

/**
 * Always resolves `globeExpanded` (default `false`), the onboarding tour (default closed), any
 * expanded HUD chart (always closed — see `closeExpandedChart`) and, whenever expanded,
 * `globeViewMode` (default `'globe'') and every legend toggle (`DEFAULT_LAYER_TOGGLES`, merged
 * with the shot's own `layerToggles`) — never only the fields a shot happens to mention.
 * `setGlobeViewMode`/
 * `setLayerToggle` click the real "Globe"/"Map" and legend buttons (`devHook.ts`'s own doc
 * comment), so resolving every time rather than only on change is what makes one shot's state
 * fully independent of whatever the previous shot left on screen (this is exactly the bug an
 * early run of this harness caught: a shot with no `state` at all silently inherited the
 * previous shot's expanded map mode — see this package's README).
 * @param {import('playwright').Page} page
 * @param {ReturnType<typeof import('./hook.mjs').makeHook>} hook
 * @param {import('./shots.mjs').ShotState} [state]
 */
async function applyState(page, hook, state = {}) {
  await hook.setPlaying(state.playing ?? false)
  await closeExpandedChart(page, hook)
  const globeExpanded = state.globeExpanded ?? false
  if (globeExpanded) {
    // Force a real collapse before every expand, even when the globe is already expanded.
    // `Globe.tsx`'s own camera code only resets zoom (and, in map mode, pan) on an actual
    // expanded-true -> false transition ("collapsing back to the minimised orb should never
    // leave it stuck at whatever zoom level the expanded sphere was left at" — its own comment);
    // two consecutive expanded shots never cross that transition, so a shot that zoomed or
    // panned leaves the camera at that same pose for every later expanded shot. A fixed-pixel
    // click like `globe-click-on-backdrop-still-closes`'s only means "empty backdrop" at the
    // default framing, so a leaked-in zoom can land it back on the globe's own silhouette.
    await hook.setGlobeExpanded(false)
    await hook.setGlobeExpanded(true)
  } else {
    await hook.setGlobeExpanded(false)
  }
  if (globeExpanded) {
    await hook.setGlobeViewMode(state.globeViewMode ?? 'globe')
    // `setGlobeViewMode` clicks the real toggle even when the mode is already correct, and a
    // real change kicks off the sphere<->map unfold tween (`Globe.tsx`, no DOM/store reflection
    // of its own progress — see `timeouts.mjs`). Without this wait, a shot with no `actions` of
    // its own to settle the tween itself (unlike the shots that trigger this toggle directly)
    // runs against a still-animating view — this is exactly how
    // `globe-click-on-backdrop-still-closes` flaked when the shot before it left map mode.
    await waitForApproxUnfoldProgress(page, 1)
    const toggles = { ...DEFAULT_LAYER_TOGGLES, ...state.layerToggles }
    for (const [key, on] of Object.entries(toggles)) await hook.setLayerToggle(key, on)
  }
  // Last, so the tour measures every anchor against the layout this shot actually ends up with
  // rather than the one it started from.
  await hook.setTourOpen(state.tour ?? false)
}

/**
 * The published manifest pins an absolute `assetBase` — a CDN host that serves no
 * `Access-Control-Allow-Origin` header. That is correct for the deployed site, where the page and
 * its media share an origin, and fatal here, where the export is served from a local port: every
 * layer fetch is CORS-blocked, `useAppData` rejects the whole batch, and the app never mounts the
 * shell `ready()` is waiting for. The same media is already inside the export under `/media/`
 * (`public/media` is a symlink to `data/media`), so requests to that host are answered from
 * there — which also makes a run deterministic and offline rather than a check against whatever
 * the CDN currently holds.
 * @param {import('playwright').Page} page
 * @param {string} baseUrl
 * @returns {Promise<string | null>} the rerouted origin, or `null` when the manifest's
 *   `assetBase` is already relative and nothing needs rerouting.
 */
async function routePublishedMediaToLocalExport(page, baseUrl) {
  const response = await page.request.get(`${baseUrl}/media/manifest.json`)
  if (!response.ok()) return null
  const { assetBase } = await response.json()
  if (typeof assetBase !== 'string' || !/^https?:\/\//.test(assetBase)) return null
  const origin = assetBase.replace(/\/+$/, '')
  await page.route(`${origin}/**`, async (route) => {
    const local = await route.fetch({ url: `${baseUrl}/media${route.request().url().slice(origin.length)}` })
    await route.fulfill({ response: local, headers: { ...local.headers(), 'access-control-allow-origin': '*' } })
  })
  return origin
}

async function runShot(page, hook, shot, runDir, viewportOverride, defaultReducedMotion, takeScreenshot) {
  const startedAt = Date.now()
  const viewport = viewportOverride ?? shot.viewport ?? DEFAULT_VIEWPORT
  await page.setViewportSize(viewport)
  // Per-shot override, e.g. the mid-unfold shot needs real motion to have a tween to sample —
  // everything else keeps the run's own default (see `--reduced-motion`'s own doc comment).
  await page.emulateMedia({ reducedMotion: shot.reducedMotion ?? defaultReducedMotion })

  if (shot.t !== undefined) {
    await hook.setT(shot.t)
    await waitForSceneCrossfadeSettle(page)
  }
  await applyState(page, hook, shot.state)
  if (shot.actions !== undefined) await shot.actions({ page, hook })
  await hook.ready()
  await rafTicks(page, 2)

  // `--no-screenshots`: measurements still read the real drawn page (`drawnBounds` screenshots
  // its own clip internally, independent of this), only the per-shot PNG and the contact sheet
  // built from it are skipped — a smoke run's speed comes from the shot count, this saves the
  // PNG encode/write on top of that.
  const screenshotName = takeScreenshot ? `${shot.name}.png` : null
  const pngPath = takeScreenshot ? path.join(runDir, screenshotName) : null
  if (takeScreenshot) await page.screenshot({ path: pngPath })

  const measurements = shot.measure !== undefined ? await shot.measure({ page, hook }) : {}
  const assertions = Object.entries(shot.expect ?? {}).map(([key, [min, max]]) => {
    const value = getPath(measurements, key)
    const pass = typeof value === 'number' && value >= min && value <= max
    return { key, value: value ?? null, min, max, pass }
  })

  return {
    name: shot.name,
    description: shot.description,
    viewport,
    t: shot.t ?? null,
    durationMs: Date.now() - startedAt,
    screenshot: screenshotName,
    pngPath,
    measurements,
    assertions,
    pass: assertions.every((a) => a.pass),
  }
}

function printSummary(results, consoleErrors) {
  console.log('')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  (${r.durationMs}ms)  — ${r.description}`)
    for (const a of r.assertions) {
      console.log(`       ${a.pass ? 'ok' : 'FAIL'}  ${a.key} = ${a.value} (expected [${a.min}, ${a.max}])`)
    }
  }
  console.log('')
  console.log(`console/page errors: ${consoleErrors.length}`)
  for (const e of consoleErrors) console.log(`  - ${e}`)
  const failed = results.filter((r) => !r.pass)
  console.log('')
  console.log(`${results.length - failed.length}/${results.length} shots passed.`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(HELP)
    return
  }

  let server = null
  let baseUrl = DEV_SERVER_URL

  if (args.dev) {
    baseUrl = DEV_SERVER_URL
  } else {
    if (!args.noBuild) runNextBuild()
    server = await startStaticServer(path.join(WEB_ROOT, 'out'), args.port)
    baseUrl = server.url
    console.log(`Serving ${path.join(WEB_ROOT, 'out')} at ${baseUrl}`)
  }

  if (args.serveOnly) {
    console.log('Serving only (--serve-only) — press Ctrl+C to stop.')
    await new Promise((resolve) => process.on('SIGINT', resolve))
    if (server !== null) await server.close()
    return
  }

  const runName = args.out ?? new Date().toISOString().replace(/[:.]/g, '-')
  const runDir = path.join(OUT_ROOT, runName)
  await mkdir(runDir, { recursive: true })

  const browser = await chromium.launch()
  const consoleErrors = []
  const results = []
  // Declared out here so the `finally` can tear the media reroute down before closing the
  // browser: a route callback still in flight when the browser goes away rejects, and that
  // rejection would otherwise surface instead of whatever actually ended the run.
  let page = null
  try {
    const context = await browser.newContext({ deviceScaleFactor: 1 })
    page = await context.newPage()
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(`console.error: ${msg.text()}`)
    })
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${String(error)}`))

    await page.emulateMedia({ reducedMotion: args.reducedMotion })
    await page.setViewportSize(DEFAULT_VIEWPORT)

    const reroutedOrigin = await routePublishedMediaToLocalExport(page, baseUrl)
    if (reroutedOrigin !== null) console.log(`Answering ${reroutedOrigin} from this export's own /media`)

    await page.goto(baseUrl, { waitUntil: 'load' })

    const hook = makeHook(page)
    try {
      // Not a shot-level concern (`ready()`'s own doc comment) — this is "did the build even
      // carry the QA hook at all", checked once, up front, with a short timeout and a message
      // that names the actual known cause rather than a bare Playwright TimeoutError: this
      // repo's Next 16/Turbopack build has, on a small fraction of otherwise-identical clean
      // builds, failed to inline `NEXT_PUBLIC_EARTHTIME_QA` (a Turbopack quirk, not this
      // harness's own gate — `devHook.ts`'s guard is a plain, correct `if`; see README "Known
      // flake"). A stale `out/` from a plain, non-QA build (`--no-build` reusing an old export)
      // hits this exact same symptom.
      await page.waitForFunction(() => window.__earthtime !== undefined, undefined, { timeout: 10_000 })
    } catch {
      throw new Error(
        'window.__earthtime never appeared. Either this out/ export was built without ' +
          'NEXT_PUBLIC_EARTHTIME_QA=1 (check --no-build / --dev), or this is the known Next ' +
          '16 + Turbopack env-inlining flake (rare, seen on an otherwise-identical clean build) ' +
          '— see README "Known flake". Fix: rebuild (drop --no-build) and re-run.',
      )
    }
    await hook.ready()

    // The first-visit tour (`@/onboarding`) opens whenever `localStorage` has no "seen it" flag,
    // and a fresh browser context never does — left alone it would cover every shot in the run.
    // Dismissed once, here, through the same path its own Skip button takes; the shots that guard
    // the tour itself re-open it via `state.tour`. Waiting for the layer to actually detach also
    // covers the race where the tour's own mount effect has not run yet when this fires: the flag
    // is written either way, so it simply never opens.
    await hook.setTourOpen(false)
    await page.waitForSelector(ONBOARDING_TOUR_SELECTOR, { state: 'detached', timeout: 10_000 })

    const shots = selectShots(shotList, args.shots)
    for (const shot of shots) {
      console.log(`Running ${shot.name}…`)
      const result = await runShot(page, hook, shot, runDir, args.viewport, args.reducedMotion, !args.noScreenshots)
      results.push(result)
    }

    let contactSheetPath = null
    if (!args.noScreenshots) {
      const contactSheetPng = await buildContactSheet(browser, results, runDir)
      contactSheetPath = path.join(runDir, 'contact-sheet.png')
      await writeFile(contactSheetPath, contactSheetPng)
    }

    const report = {
      startedAt: new Date().toISOString(),
      baseUrl,
      reducedMotion: args.reducedMotion,
      consoleErrors,
      shots: results.map(({ pngPath: _pngPath, ...rest }) => rest),
      contactSheet: contactSheetPath !== null ? 'contact-sheet.png' : null,
      pass: results.every((r) => r.pass) && consoleErrors.length === 0,
    }
    await writeFile(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2))

    printSummary(results, consoleErrors)
    console.log(`Report: ${path.join(runDir, 'report.json')}`)
    if (contactSheetPath !== null) console.log(`Contact sheet: ${contactSheetPath}`)

    await rm(path.join(OUT_ROOT, 'latest'), { force: true, recursive: true }).catch(() => {})
    await symlink(runDir, path.join(OUT_ROOT, 'latest')).catch(() => {})

    if (!report.pass) process.exitCode = 1
  } finally {
    if (page !== null) await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {})
    await browser.close()
    if (server !== null) await server.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
