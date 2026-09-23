#!/usr/bin/env node
/**
 * Visual-QA harness runner. One `next build` (unless `--dev`/`--no-build`), one static server,
 * one browser, one page load (plus one in a `hasTouch` context for `touch: true` shots) — every
 * shot drives an already-loaded page through `window.__earthtime` (`web/src/store/devHook.ts`)
 * rather than reloading. See `README.md` for the full contract and CLI reference; `--help` prints
 * the same summary.
 */

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs'
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { resolveChromium } from './browser.mjs'
import { buildContactSheet } from './contactSheet.mjs'
import { makeHook, rafTicks, waitForGlobeFitFramesStable } from './hook.mjs'
import { startStaticServer } from './server.mjs'
import { ONBOARDING_TOUR_SELECTOR } from './selectors.mjs'
import shotList from './shots.mjs'
import smokeShotNames from './smokeShots.mjs'
import { waitForApproxUnfoldProgress, waitForSceneCrossfadeSettle, waitForSectionWindowSettle } from './timeouts.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = path.resolve(__dirname, '../..')
const QA_ROOT = __dirname
const OUT_ROOT = path.join(QA_ROOT, 'out')
const NEXT_BIN = path.join(WEB_ROOT, 'node_modules/.bin/next')
/** Where `NEXT_PUBLIC_EARTHTIME_QA=1 next build` exports (`next.config.ts`): apart from an ordinary
 *  build's `out/`, so one can never replace the QA export with a build lacking the hook. */
const QA_EXPORT_DIR = path.join(WEB_ROOT, 'out-qa')
/** Written into the export after a build that carried the QA hook: what it was built from. */
const SOURCE_STAMP_FILE = path.join(QA_EXPORT_DIR, '.qa-source-stamp')
const MEDIA_DIR = path.join(WEB_ROOT, 'public/media')
const DEV_PID_FILE = path.join(OUT_ROOT, 'dev-server.json')
const DEV_LOG_FILE = path.join(OUT_ROOT, 'dev-server.log')
const DEFAULT_VIEWPORT = { width: 1440, height: 900 }

/** A `next dev` port of this checkout's own, in 3100-3899, so `--dev` runs in two worktrees never
 *  attach to each other's server. */
function checkoutDevPort() {
  const digest = createHash('sha1').update(realpathSync(WEB_ROOT)).digest()
  return 3100 + (digest.readUInt32BE(0) % 800)
}

const HELP = `
Visual-QA harness for the Earthlapse web app.

Usage:
  pnpm qa [options]              build + serve + run the full (or filtered) shot list
  pnpm qa:serve                  build (unless --no-build) + serve out-qa/, print the URL, and wait

Options:
  --dev                      run against \`next dev\` on this checkout's own port (started, and
                             left running for the next --dev run, when nothing answers there)
  --stop-dev                 stop the \`next dev\` server an earlier --dev run started, then exit
  --no-build                 skip \`next build\`, reuse the existing out-qa/ export
  --rebuild                  build even when out-qa/ is up to date with the source
  --serve-only               build (unless --no-build) + serve, then idle until Ctrl+C (no shots run)
  --shots <a,b,c*>           comma-separated shot names/globs (matched against each shot's \`name\`)
  --grep <regex>             run only shots whose name matches; narrows --shots further
  --smoke                    run only \`smokeShots.mjs\`'s named subset (ignored if --shots is also given)
  --extra-shots <file>       append a second shot module (default export) to the shot list
  --no-screenshots           skip screenshots and the contact sheet (failures still capture one)
  --no-sort                  run shots in file order instead of grouped by viewport
  --shards <n>               split the shots across n pages loaded in parallel (default 1)
  --viewport <WxH>           override every shot's own viewport
  --reduced-motion <mode>    'reduce' (default) or 'no-preference'
  --port <n>                 static server port (default: QA_PORT, else an ephemeral free port)
  --out <name>               run folder name under scripts/qa/out/ (default: a timestamp)
  --help                     print this message

Environment:
  QA_CHROMIUM                Chromium binary to launch (default: discovered, see browser.mjs)
  QA_DEV_PORT                the \`next dev\` port --dev uses (default: ${checkoutDevPort()}, this checkout's)
  QA_PORT                    static server port, as --port
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
    stopDev: false,
    noBuild: false,
    rebuild: false,
    serveOnly: false,
    shots: null,
    grep: null,
    smoke: false,
    extraShots: null,
    screenshots: true,
    sort: true,
    shards: 1,
    viewport: null,
    reducedMotion: 'reduce',
    port: Number(process.env.QA_PORT ?? 0),
    out: null,
    help: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dev') args.dev = true
    else if (arg === '--stop-dev') args.stopDev = true
    else if (arg === '--no-build') args.noBuild = true
    else if (arg === '--rebuild') args.rebuild = true
    else if (arg === '--serve-only') args.serveOnly = true
    else if (arg === '--help' || arg === '-h') args.help = true
    else if (arg === '--shots') args.shots = argv[(i += 1)].split(',').map((s) => s.trim())
    else if (arg === '--grep') args.grep = new RegExp(argv[(i += 1)])
    else if (arg === '--extra-shots') args.extraShots = path.resolve(argv[(i += 1)])
    else if (arg === '--no-screenshots') args.screenshots = false
    else if (arg === '--no-sort') args.sort = false
    else if (arg === '--shards') args.shards = Math.max(1, Number.parseInt(argv[(i += 1)], 10) || 1)
    else if (arg === '--smoke') args.smoke = true
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

/** `--shots` names shots exactly (or by `*` glob); `--grep` takes one regex matched anywhere in a
 *  name, which is what makes "every phone shot" or "everything about the breadcrumb" expressible
 *  without listing them. Both may be given: each narrows what the other left. */
function selectShots(all, filters, grep) {
  let selected = all
  if (filters !== null) {
    const patterns = filters.map((filter) => ({ filter, regex: globToRegExp(filter) }))
    selected = selected.filter((shot) => patterns.some((p) => p.regex.test(shot.name)))
    if (selected.length === 0) throw new Error(`--shots matched nothing (filters: ${filters.join(', ')})`)
    const unmatched = patterns.filter((p) => !all.some((shot) => p.regex.test(shot.name))).map((p) => p.filter)
    if (unmatched.length > 0) console.warn(`warning: these --shots filters matched no shot: ${unmatched.join(', ')}`)
  }
  if (grep !== null) {
    selected = selected.filter((shot) => grep.test(shot.name))
    if (selected.length === 0) throw new Error(`--grep ${grep.source} matched nothing`)
  }
  return selected
}

function getPath(obj, dotPath) {
  return dotPath.split('.').reduce((value, key) => (value === undefined || value === null ? undefined : value[key]), obj)
}

/** Files under `dir` (following symlinks, so `public/media`'s content counts), as paths. */
function walkFiles(dir, keep = () => true) {
  const files = []
  const visit = (current) => {
    for (const name of readdirSync(current)) {
      const full = path.join(current, name)
      const info = statSync(full)
      if (info.isDirectory()) visit(full)
      else if (keep(full)) files.push({ full, info })
    }
  }
  if (existsSync(dir)) visit(dir)
  return files
}

/**
 * What a QA export is built from, as one hash over every input's path, size and mtime (tests
 * excluded) plus the `NEXT_PUBLIC_*` environment it inlines. Stat-only, so ~10 ms: a content hash
 * would read the ~90 MB of media on every run.
 */
function sourceStamp() {
  const hash = createHash('sha1')
  const isInput = (file) => !/\.test\.tsx?$/.test(file) && !file.includes(`${path.sep}src${path.sep}test${path.sep}`)
  const files = [
    ...walkFiles(path.join(WEB_ROOT, 'src'), isInput),
    ...walkFiles(path.join(WEB_ROOT, 'public')),
    ...['next.config.ts', 'package.json', 'pnpm-lock.yaml', 'tsconfig.json']
      .map((name) => path.join(WEB_ROOT, name))
      .filter((full) => existsSync(full))
      .map((full) => ({ full, info: statSync(full) })),
  ]
  for (const { full, info } of files) hash.update(`${path.relative(WEB_ROOT, full)}\0${info.size}\0${info.mtimeMs}\n`)
  for (const key of Object.keys(process.env).filter((k) => k.startsWith('NEXT_PUBLIC_')).sort()) {
    hash.update(`${key}=${process.env[key]}\n`)
  }
  return hash.digest('hex')
}

/** Whether the export's JS carries the QA hook: Next 16 + Turbopack occasionally fails to inline
 *  `NEXT_PUBLIC_EARTHTIME_QA` (README, "Known flakes"). */
function exportCarriesHook() {
  return walkFiles(path.join(QA_EXPORT_DIR, '_next/static'), (file) => file.endsWith('.js')).some(({ full }) =>
    readFileSync(full, 'utf8').includes('__earthtime'),
  )
}

async function readStamp() {
  try {
    return (await readFile(SOURCE_STAMP_FILE, 'utf8')).trim()
  } catch {
    return null
  }
}

/** Builds the QA export unless `out-qa/` was already built from exactly this source. */
async function ensureQaExport(args) {
  const stamp = sourceStamp()
  if (!args.rebuild && (await readStamp()) === stamp) {
    console.log('out-qa/ is up to date with the source; skipping next build (--rebuild forces one)')
    return
  }
  console.log('Building the QA export into out-qa/ (NEXT_PUBLIC_EARTHTIME_QA=1 next build)…')
  const result = spawnSync(NEXT_BIN, ['build'], {
    cwd: WEB_ROOT,
    env: { ...process.env, NEXT_PUBLIC_EARTHTIME_QA: '1' },
    stdio: 'inherit',
  })
  if (result.status !== 0) throw new Error(`next build failed (exit ${result.status})`)
  if (!exportCarriesHook()) {
    throw new Error(
      'the fresh out-qa/ export has no window.__earthtime: the known Next 16 + Turbopack ' +
        'env-inlining flake (README, "Known flakes"). Re-run to rebuild.',
    )
  }
  await writeFile(SOURCE_STAMP_FILE, `${stamp}\n`)
}

/** Fails fast, naming the `scripts/setup.sh` part to run, when something the run needs is absent. */
async function checkPreconditions(args) {
  const missing = (what, part) => {
    console.error(`missing ${what} — run scripts/setup.sh ${part}`)
    process.exit(2)
  }
  if (!existsSync(NEXT_BIN) || !existsSync(path.join(WEB_ROOT, 'node_modules/playwright'))) {
    missing('web dependencies (web/node_modules)', 'web')
  }
  // The shots measure published scenes and layers: the stub manifest the app falls back to
  // without media, or LFS pointers in place of images, fail them in confusing ways.
  if (!existsSync(path.join(MEDIA_DIR, 'manifest.json'))) missing('media (web/public/media)', 'media')
  const sample = walkFiles(path.join(MEDIA_DIR, 'scenes'), (file) => /\.(webp|png|jpg)$/.test(file)).slice(0, 20)
  const pointer = sample.find(({ full, info }) => info.size < 200 && readFileSync(full, 'utf8').startsWith('version https://git-lfs'))
  if (pointer !== undefined) missing(`media content (${path.relative(WEB_ROOT, pointer.full)} is an LFS pointer)`, 'media')
  if (!args.serveOnly && (await resolveChromium()) === null) missing('a Chromium to launch', 'browser')
}

async function responds(url, timeoutMs) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return response.ok
  } catch {
    return false
  }
}

function processAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * The `next dev` server `--dev` runs against: whatever answers on this checkout's port, or a new
 * one started there, detached so the next `--dev` run attaches in a second instead of paying the
 * start-up and first compile again.
 */
async function ensureDevServer() {
  const port = Number(process.env.QA_DEV_PORT ?? checkoutDevPort())
  const url = `http://localhost:${port}`
  if (await responds(url, 5_000)) {
    let ours = false
    try {
      const started = JSON.parse(readFileSync(DEV_PID_FILE, 'utf8'))
      ours = started.port === port && processAlive(started.pid)
    } catch {
      // no record of a server this harness started
    }
    console.log(`Attaching to next dev at ${url}${ours ? '' : ' (not started by this checkout\'s harness)'}`)
    return url
  }
  await mkdir(OUT_ROOT, { recursive: true })
  const log = openSync(DEV_LOG_FILE, 'a')
  // Without the QA flag: it would move `distDir` to out-qa/, the static export's directory.
  const { NEXT_PUBLIC_EARTHTIME_QA: _qa, ...env } = process.env
  const child = spawn(NEXT_BIN, ['dev', '--port', String(port)], { cwd: WEB_ROOT, env, detached: true, stdio: ['ignore', log, log] })
  child.unref()
  let exited = null
  child.on('exit', (code) => {
    exited = code
  })
  await writeFile(DEV_PID_FILE, JSON.stringify({ pid: child.pid, port }))
  console.log(`Starting next dev at ${url} (pid ${child.pid}, log ${DEV_LOG_FILE}); it stays up for the next --dev run: kill ${child.pid} to stop it`)
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    if (exited !== null) throw new Error(`next dev exited (code ${exited}); see ${DEV_LOG_FILE}`)
    // The first request compiles the page, so it gets the whole remaining budget.
    if (await responds(url, deadline - Date.now())) return url
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`next dev did not answer at ${url} within 180 s; see ${DEV_LOG_FILE}`)
}

function stopDevServer() {
  let started = null
  try {
    started = JSON.parse(readFileSync(DEV_PID_FILE, 'utf8'))
  } catch {
    // nothing recorded
  }
  if (started !== null && processAlive(started.pid)) {
    // Detached, so it leads its own process group: this also stops the workers it spawned.
    process.kill(-started.pid, 'SIGTERM')
    console.log(`Stopped next dev (pid ${started.pid}, port ${started.port})`)
  } else {
    console.log('No next dev started by this harness is running')
  }
  rmSync(DEV_PID_FILE, { force: true })
}

/** `Globe.tsx`'s own defaults for state this harness can't reload away — a fresh mount would
 *  start here, and the legend's toggles are session-sticky (nothing in the app resets them but a
 *  click), so a shot that doesn't mention one inherits whatever an *earlier* shot left it at
 *  unless every shot that expands the globe re-asserts the full baseline, merged with its own
 *  overrides, below. */
const DEFAULT_LAYER_TOGGLES = { 'human-civilisation': true }

/** `timeline/sections.ts`'s `ROOT_SECTION_ID`, mirrored: this harness has no TS/build step. */
const ROOT_SECTION_ID = 'earth'

/**
 * Closes the "All events" browser if a previous shot left it open, by its real close button: its
 * open state is local to `Experience.tsx`, with no `devHook.ts` setter.
 * @param {import('playwright').Page} page
 * @param {ReturnType<typeof import('./hook.mjs').makeHook>} hook
 */
async function closeEventBrowser(page, hook) {
  const browser = page.locator('[data-testid="event-browser"]')
  if ((await browser.count()) === 0) return
  await browser.getByRole('button', { name: 'Close', exact: true }).click()
  await hook.ready()
  await rafTicks(page, 2)
}

/** Any open dialog but the tour's own (`setTourOpen` owns that one): an event's or a caption's
 *  detail panel, About & credits, a timeline cluster popover. Their open state is local to the
 *  components that own them, so the harness closes them the way a user does. */
const OPEN_DIALOG_SELECTOR = `[role="dialog"]:not(${ONBOARDING_TOUR_SELECTOR} *)`

/**
 * Closes every open dialog by its own "Close" button. A panel that would not close throws, failing
 * this shot rather than leaving its backdrop over the next shot's clicks.
 * @param {import('playwright').Page} page
 * @param {ReturnType<typeof import('./hook.mjs').makeHook>} hook
 */
async function closeOpenDialogs(page, hook) {
  const dialogs = page.locator(OPEN_DIALOG_SELECTOR)
  for (let attempt = 0; attempt < 4 && (await dialogs.count()) > 0; attempt += 1) {
    await dialogs.last().getByRole('button', { name: 'Close', exact: true }).first().click()
    await hook.ready()
    await rafTicks(page, 2)
  }
  if ((await dialogs.count()) > 0) throw new Error('an open dialog did not close on its Close button')
}

/**
 * Resolves every field `state` covers on every shot, never only the ones a shot mentions: the
 * selected section (the root), playback, `globeExpanded` (default `false`), any open dialog, the
 * event browser (always closed), and, when expanded, `globeViewMode` (default `'globe'`)
 * and every legend toggle (`DEFAULT_LAYER_TOGGLES` merged with the shot's own), then the tour. That
 * is what keeps one shot independent of whatever the previous one left on screen.
 *
 * A collapse returns the globe to sphere mode (`Globe.tsx` resets `mapMode`), so only a `'map'`
 * shot changes mode here, and under reduced motion the unfold snaps rather than tweening: the
 * tween's blind wait is paid only when both hold. The expand itself is settled by polling its fit
 * frames (`waitForGlobeFitFramesStable`).
 * @param {import('playwright').Page} page
 * @param {ReturnType<typeof import('./hook.mjs').makeHook>} hook
 * @param {import('./shots.mjs').ShotState} [state]
 * @param {string} [reducedMotion] the shot's effective `prefers-reduced-motion`
 */
async function applyState(page, hook, state = {}, reducedMotion = 'reduce') {
  // The resets that need no real click, and what else needs resetting, in one round trip: with
  // the globe expanded every round trip waits out a software-rendered frame.
  const reset = await page.evaluate(
    ({ playing, rootSectionId, dialogSelector }) => {
      const qa = window.__earthtime
      qa.setPlaying(playing)
      const { sectionId, globeExpanded } = qa.getState()
      // Every shot starts at the root section; `t` is unaffected, since the root spans all of it.
      if (sectionId !== rootSectionId) qa.selectSection(rootSectionId)
      // Collapsed first: the expanded canvas covers the HUD controls the closers below click,
      // and the camera (zoom, map pan) resets only on a real collapse.
      if (globeExpanded) qa.setGlobeExpanded(false)
      return {
        sectionChanged: sectionId !== rootSectionId,
        collapsed: globeExpanded,
        dialogOpen: document.querySelector(dialogSelector) !== null,
        eventBrowserOpen: document.querySelector('[data-testid="event-browser"]') !== null,
      }
    },
    { playing: state.playing ?? false, rootSectionId: ROOT_SECTION_ID, dialogSelector: OPEN_DIALOG_SELECTOR },
  )
  if (reset.sectionChanged) await waitForSectionWindowSettle(page)
  // The frames between collapse and any re-expand let React commit the collapse rather than
  // batch it away.
  if (reset.collapsed) {
    await hook.ready()
    await rafTicks(page, 2)
  }
  if (reset.dialogOpen) {
    await closeOpenDialogs(page, hook)
    // A panel that paused playback resumes it on close.
    await page.evaluate((playing) => window.__earthtime.setPlaying(playing), state.playing ?? false)
  }
  if (reset.eventBrowserOpen) await closeEventBrowser(page, hook)
  if (state.globeExpanded ?? false) {
    await hook.setGlobeExpanded(true)
    await hook.ready()
    await waitForGlobeFitFramesStable(page)
    const modeChanged = await page.evaluate(
      ({ mode, toggles }) => {
        const qa = window.__earthtime
        const changed = qa.getGlobeViewMode() !== mode
        if (changed) qa.setGlobeViewMode(mode)
        // `Legend.tsx` renders nothing on phone viewports and drops a row once its overlay is out
        // of data domain, so the toggles are resolved only while its panel is present; a key
        // whose row is missing while the panel is there still throws.
        if (document.querySelector('[class*="legendGroup"]') !== null) {
          for (const [key, on] of Object.entries(toggles)) qa.setLayerToggle(key, on)
        }
        return changed
      },
      { mode: state.globeViewMode ?? 'globe', toggles: { ...DEFAULT_LAYER_TOGGLES, ...state.layerToggles } },
    )
    if (modeChanged) {
      if (reducedMotion === 'no-preference') await waitForApproxUnfoldProgress(page, 1)
      await waitForGlobeFitFramesStable(page)
    }
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

/** `shot.expect`'s dot-path ranges, checked against a `measure()`/`bootstrapsPage()` result —
 *  shared by `runShot` and `runBootstrapShot` so a shot asserts the same way regardless of which
 *  one produced its measurements. */
function buildAssertions(measurements, expect) {
  return Object.entries(expect ?? {}).map(([key, [min, max]]) => {
    const value = getPath(measurements, key)
    const pass = typeof value === 'number' && value >= min && value <= max
    return { key, value: value ?? null, min, max, pass }
  })
}

/** A shot's `expect` table, or, when it is a function, the table it returns for this run's mode:
 *  a check too slow for `--smoke` is measured and asserted only in the full run. */
function shotExpect(shot, run) {
  return typeof shot.expect === 'function' ? shot.expect({ smoke: run.smoke }) : shot.expect
}

/** `run` carries the settings that are the same for every shot in a run — where output goes, the
 *  `--viewport`/`--reduced-motion` overrides, and whether screenshots are captured at all. One
 *  object rather than five positional arguments, since every one of them would otherwise have to
 *  be threaded through `runShotOrRecordFailure` untouched. */
async function runShot(page, hook, shot, run) {
  const startedAt = Date.now()
  const viewport = run.viewport ?? shot.viewport ?? DEFAULT_VIEWPORT
  await page.setViewportSize(viewport)
  // Per-shot override, for a shot that needs real motion to have something to measure.
  const reducedMotion = shot.reducedMotion ?? run.reducedMotion
  await page.emulateMedia({ reducedMotion })

  // A `t` the store already holds starts no crossfade, so only the remainder of one an earlier
  // shot's own `setT` may have left running is waited out.
  if (shot.t !== undefined) {
    if ((await hook.getState())?.t !== shot.t) {
      await hook.setT(shot.t)
      await waitForSceneCrossfadeSettle(page)
    } else {
      await waitForSceneCrossfadeSettle(page, Date.now() - hook.lastSetTAt)
    }
  }
  await applyState(page, hook, shot.state, reducedMotion)
  if (shot.actions !== undefined) await shot.actions({ page, hook })
  await hook.ready()
  await rafTicks(page, 2)

  // `--no-screenshots` skips both the capture and the contact sheet built from it: a full-page
  // PNG is the single most expensive thing a shot does and several MB of the run's output, and an
  // iteration loop that only reads assertion numbers never opens one.
  const screenshotName = run.screenshots ? `${shot.name}.png` : null
  const pngPath = screenshotName === null ? null : path.join(run.runDir, screenshotName)
  if (pngPath !== null) await page.screenshot({ path: pngPath })

  const measurements = shot.measure !== undefined ? await shot.measure({ page, hook, smoke: run.smoke }) : {}
  const assertions = buildAssertions(measurements, shotExpect(shot, run))

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

/**
 * Runs a shot that owns the harness's one, one-time page load itself (`shot.bootstrapsPage`) —
 * the loader-screen shot's own need to intercept that exact load, since the loading screen is
 * gone by the time an ordinary shot's turn comes around (`shots.mjs`'s own doc comment on
 * `bootstrapsPage`). Called from `main` in place of the plain `page.goto`, before `hook` even
 * exists; everything after (`window.__earthtime`, `hook.ready()`, the tour dismissal) still runs
 * exactly as it does for the generic path, once this returns.
 * @param {import('playwright').Page} page
 * @param {import('./shots.mjs').Shot} shot
 * @param {{ runDir: string, screenshots: boolean, reducedMotion: string }} run
 * @param {string} baseUrl
 */
async function runBootstrapShot(page, shot, run, baseUrl) {
  const startedAt = Date.now()
  const viewport = shot.viewport ?? DEFAULT_VIEWPORT
  await page.setViewportSize(viewport)
  await page.emulateMedia({ reducedMotion: shot.reducedMotion ?? run.reducedMotion })

  const { measurements, screenshot } = await shot.bootstrapsPage({ page, baseUrl, run })
  const screenshotName = screenshot !== null && screenshot !== undefined ? `${shot.name}.png` : null
  const pngPath = screenshotName === null ? null : path.join(run.runDir, screenshotName)
  if (pngPath !== null) await writeFile(pngPath, screenshot)
  const assertions = buildAssertions(measurements, shotExpect(shot, run))

  return {
    name: shot.name,
    description: shot.description,
    viewport,
    t: null,
    durationMs: Date.now() - startedAt,
    screenshot: screenshotName,
    pngPath,
    measurements,
    assertions,
    pass: assertions.every((a) => a.pass),
  }
}

/** A 1x1 transparent PNG — the contact sheet's fallback image for a shot that crashed before it
 *  could take its own screenshot (`runShotOrRecordFailure`'s catch branch). */
const EMPTY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

/**
 * Runs one shot; a throw from anywhere inside it (a page error, not an assertion miss) is recorded
 * as that shot's failure rather than aborting the rest of the run, with a best-effort screenshot
 * of the page as it was when it threw.
 * @param {import('playwright').Page} page
 * @param {ReturnType<typeof import('./hook.mjs').makeHook>} hook
 * @param {import('./shots.mjs').Shot} shot
 * @param {{ runDir: string, viewport: {width: number, height: number} | null, reducedMotion: string, screenshots: boolean }} run
 */
async function runShotOrRecordFailure(page, hook, shot, run) {
  const startedAt = Date.now()
  try {
    return await runShot(page, hook, shot, run)
  } catch (error) {
    console.error(`FAILED ${shot.name}: ${error?.stack ?? error}`)
    // A failure's screenshot is the one worth keeping even under `--no-screenshots`: it is the
    // only record of what the page looked like when it threw.
    const screenshotName = `${shot.name}.png`
    const pngPath = path.join(run.runDir, screenshotName)
    try {
      await page.screenshot({ path: pngPath })
    } catch {
      await writeFile(pngPath, EMPTY_PNG)
    }
    return {
      name: shot.name,
      description: shot.description,
      viewport: run.viewport ?? shot.viewport ?? DEFAULT_VIEWPORT,
      t: shot.t ?? null,
      durationMs: Date.now() - startedAt,
      screenshot: screenshotName,
      pngPath,
      measurements: {},
      assertions: [],
      error: String(error?.stack ?? error),
      pass: false,
    }
  }
}

/** The bootstrap shot's own analogue of `runShotOrRecordFailure`: it runs before `hook` exists and
 *  owns the harness's one navigation, so a throw here would otherwise take the whole run down
 *  (there is no later shot to fall back to a plain load for). Same best-effort failure screenshot. */
async function runBootstrapShotOrRecordFailure(page, shot, run, baseUrl) {
  const startedAt = Date.now()
  try {
    return await runBootstrapShot(page, shot, run, baseUrl)
  } catch (error) {
    console.error(`FAILED ${shot.name}: ${error?.stack ?? error}`)
    const screenshotName = `${shot.name}.png`
    const pngPath = path.join(run.runDir, screenshotName)
    try {
      await page.screenshot({ path: pngPath })
    } catch {
      await writeFile(pngPath, EMPTY_PNG)
    }
    return {
      name: shot.name,
      description: shot.description,
      viewport: shot.viewport ?? DEFAULT_VIEWPORT,
      t: null,
      durationMs: Date.now() - startedAt,
      screenshot: screenshotName,
      pngPath,
      measurements: {},
      assertions: [],
      error: String(error?.stack ?? error),
      pass: false,
    }
  }
}

function printSummary(results, consoleErrors) {
  console.log('')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  (${r.durationMs}ms)  — ${r.description}`)
    if (r.error !== undefined) console.log(`       ERROR  ${r.error.split('\n')[0]}`)
    for (const a of r.assertions) {
      console.log(`       ${a.pass ? 'ok' : 'FAIL'}  ${a.key} = ${a.value} (expected [${a.min}, ${a.max}])`)
    }
  }
  console.log('')
  console.log(`console/page errors: ${consoleErrors.length}`)
  for (const e of consoleErrors) console.log(`  - ${e}`)
  console.log('')
  console.log('Slowest shots:')
  for (const r of [...results].sort((a, b) => b.durationMs - a.durationMs).slice(0, 10)) {
    console.log(`  ${String(r.durationMs).padStart(7)}ms  ${r.name}`)
  }
  const failed = results.filter((r) => !r.pass)
  console.log('')
  console.log(`${results.length - failed.length}/${results.length} shots passed.`)
}

function viewportKey(shot, override) {
  const v = override ?? shot.viewport ?? DEFAULT_VIEWPORT
  return `${v.width}x${v.height}`
}

/**
 * Groups shots by viewport, keeping file order within a group and ordering groups by first
 * appearance — a resize reflows the whole shell, so running a viewport's shots back to back
 * spends one resize per group rather than one per shot. The page-bootstrapping shot, and its
 * viewport's group, stay first: that shot runs before any other regardless.
 */
function sortByViewport(shots, override) {
  const groupOrder = new Map()
  const bootstrap = shots.find((shot) => shot.bootstrapsPage !== undefined)
  groupOrder.set(bootstrap === undefined ? viewportKey({}, override) : viewportKey(bootstrap, override), 0)
  for (const shot of shots) if (!groupOrder.has(viewportKey(shot, override))) groupOrder.set(viewportKey(shot, override), groupOrder.size)
  const rank = (shot) => (shot.bootstrapsPage !== undefined ? -1 : groupOrder.get(viewportKey(shot, override)))
  return shots
    .map((shot, index) => ({ shot, index }))
    .sort((a, b) => rank(a.shot) - rank(b.shot) || a.index - b.index)
    .map(({ shot }) => shot)
}

/** `count` contiguous, near-equal slices of `list` (fewer when `list` is shorter than `count`). */
function contiguousChunks(list, count) {
  const chunks = []
  const size = Math.ceil(list.length / count)
  for (let i = 0; i < list.length; i += size) chunks.push(list.slice(i, i + size))
  return chunks
}

/**
 * One browser context and page, loaded once and ready for shots: console errors collected into
 * `consoleErrors` (prefixed with `label` when set), touch input enabled with `hasTouch`, published
 * media rerouted to the local export,
 * the app loaded (by `bootstrapShot` when given), the QA hook confirmed present, and the
 * first-visit tour dismissed.
 * @returns {Promise<{ page: import('playwright').Page, hook: ReturnType<typeof makeHook>, bootstrapResult: object | null }>}
 */
async function openLoadedPage(browser, { baseUrl, args, run, consoleErrors, label, bootstrapShot, hasTouch = false }) {
  const context = await browser.newContext({ deviceScaleFactor: 1, hasTouch })
  const page = await context.newPage()
  const prefix = label === null ? '' : `[${label}] `
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`${prefix}console.error: ${msg.text()}`)
  })
  page.on('pageerror', (error) => consoleErrors.push(`${prefix}pageerror: ${String(error)}`))

  await page.emulateMedia({ reducedMotion: args.reducedMotion })
  await page.setViewportSize(DEFAULT_VIEWPORT)

  const reroutedOrigin = await routePublishedMediaToLocalExport(page, baseUrl)
  if (reroutedOrigin !== null && label === null) console.log(`Answering ${reroutedOrigin} from this export's own /media`)

  // At most one shot ever owns the harness's page load (`shots.mjs`'s doc comment on
  // `bootstrapsPage`) — the loading screen is only on screen during that one navigation.
  let bootstrapResult = null
  if (bootstrapShot !== undefined) {
    console.log(`${prefix}Running ${bootstrapShot.name} (owns the page load)…`)
    bootstrapResult = await runBootstrapShotOrRecordFailure(page, bootstrapShot, run, baseUrl)
  } else {
    await page.goto(baseUrl, { waitUntil: 'load' })
  }

  const hook = makeHook(page)
  try {
    // "Did the build carry the QA hook at all", checked once with a message naming the known
    // causes rather than a bare TimeoutError: an export built without NEXT_PUBLIC_EARTHTIME_QA=1
    // (a stale `--no-build` out-qa/), or the Next 16 + Turbopack env-inlining flake (README).
    await page.waitForFunction(() => window.__earthtime !== undefined, undefined, { timeout: 10_000 })
  } catch {
    throw new Error(
      'window.__earthtime never appeared. Either this out-qa/ export was built without ' +
        'NEXT_PUBLIC_EARTHTIME_QA=1 (check --no-build / --dev), or this is the known Next ' +
        '16 + Turbopack env-inlining flake (rare, seen on an otherwise-identical clean build) ' +
        '— see README "Known flake". Fix: rebuild (drop --no-build) and re-run.',
    )
  }
  await hook.ready()

  // A fresh context has no "seen it" flag, so the first-visit tour opens on load and would cover
  // every shot. Dismissed through the same path its Skip button takes; waiting for the layer to
  // detach also covers the tour's mount effect not having run yet (the flag is written either
  // way, so it then never opens). The shots that guard the tour re-open it via `state.tour`.
  await hook.setTourOpen(false)
  await page.waitForSelector(ONBOARDING_TOUR_SELECTOR, { state: 'detached', timeout: 10_000 })
  return { page, hook, bootstrapResult }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(HELP)
    return
  }

  if (args.stopDev) {
    stopDevServer()
    return
  }
  await checkPreconditions(args)

  let server = null
  let baseUrl
  if (args.dev) {
    baseUrl = await ensureDevServer()
  } else {
    if (!args.noBuild) await ensureQaExport(args)
    server = await startStaticServer(QA_EXPORT_DIR, args.port)
    baseUrl = server.url
    console.log(`Serving ${QA_EXPORT_DIR} at ${baseUrl}`)
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

  const { chromium } = await import('playwright')
  const { executablePath } = await resolveChromium()
  const browser = await chromium.launch({ executablePath })
  const consoleErrors = []
  const pages = []
  const startedAt = Date.now()
  try {
    const run = {
      runDir,
      viewport: args.viewport,
      reducedMotion: args.reducedMotion,
      screenshots: args.screenshots,
      smoke: args.smoke,
    }
    // `--extra-shots` lets a new shot be written, run and proven to fail-before-fix in its own
    // file while `shots.mjs` is being edited elsewhere (CLAUDE.md, "Working in parallel").
    const extra = args.extraShots === null ? [] : (await import(pathToFileURL(args.extraShots).href)).default
    const selected = selectShots([...shotList, ...extra], args.shots, args.grep)
    const shots = args.sort ? sortByViewport(selected, args.viewport) : selected
    const bootstrapShot = shots.find((shot) => shot.bootstrapsPage !== undefined)
    const touchShots = shots.filter((shot) => shot.touch === true)
    const chunks = contiguousChunks(
      shots.filter((shot) => shot !== bootstrapShot && shot.touch !== true),
      args.shards,
    )
    if (chunks.length === 0 && (touchShots.length === 0 || bootstrapShot !== undefined)) chunks.push([])

    console.log(`Running ${shots.length} of ${shotList.length + extra.length} shots${chunks.length > 1 ? ` across ${chunks.length} pages` : ''}…`)
    const resultsByName = new Map()
    await Promise.all(
      chunks.map(async (chunk, index) => {
        const label = chunks.length > 1 ? `shard ${index}` : null
        const loaded = await openLoadedPage(browser, {
          baseUrl,
          args,
          run,
          consoleErrors,
          label,
          bootstrapShot: index === 0 ? bootstrapShot : undefined,
        })
        pages.push(loaded.page)
        if (loaded.bootstrapResult !== null) resultsByName.set(bootstrapShot.name, loaded.bootstrapResult)
        for (const shot of chunk) {
          console.log(`${label === null ? '' : `[${label}] `}Running ${shot.name}…`)
          resultsByName.set(shot.name, await runShotOrRecordFailure(loaded.page, loaded.hook, shot, run))
        }
      }),
    )
    // Playwright fixes `hasTouch` per context, so touch shots run afterwards on a page of their own.
    if (touchShots.length > 0) {
      const loaded = await openLoadedPage(browser, { baseUrl, args, run, consoleErrors, label: 'touch', bootstrapShot: undefined, hasTouch: true })
      pages.push(loaded.page)
      for (const shot of touchShots) {
        console.log(`[touch] Running ${shot.name}…`)
        resultsByName.set(shot.name, await runShotOrRecordFailure(loaded.page, loaded.hook, shot, run))
      }
    }
    const results = shots.map((shot) => resultsByName.get(shot.name))

    // Nothing to sheet when every shot that passed skipped its screenshot; a run with failures
    // still has theirs, so the sheet is built whenever any image exists.
    const sheeted = results.filter((r) => r.pngPath !== null)
    const contactSheetPath = sheeted.length > 0 ? path.join(runDir, 'contact-sheet.png') : null
    if (contactSheetPath !== null) {
      await writeFile(contactSheetPath, await buildContactSheet(browser, sheeted, runDir))
    }

    const report = {
      startedAt: new Date(startedAt).toISOString(),
      wallTimeMs: Date.now() - startedAt,
      shards: chunks.length,
      baseUrl,
      reducedMotion: args.reducedMotion,
      consoleErrors,
      shots: results.map(({ pngPath: _pngPath, ...rest }) => rest),
      contactSheet: contactSheetPath === null ? null : 'contact-sheet.png',
      pass: results.every((r) => r.pass) && consoleErrors.length === 0,
    }
    await writeFile(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2))

    printSummary(results, consoleErrors)
    console.log(`Wall time: ${(report.wallTimeMs / 1000).toFixed(1)}s`)
    console.log(`Report: ${path.join(runDir, 'report.json')}`)
    if (contactSheetPath !== null) console.log(`Contact sheet: ${contactSheetPath}`)

    await rm(path.join(OUT_ROOT, 'latest'), { force: true, recursive: true }).catch(() => {})
    await symlink(runDir, path.join(OUT_ROOT, 'latest')).catch(() => {})

    if (!report.pass) process.exitCode = 1
  } finally {
    // Tear the media reroute down before closing the browser: a route callback still in flight
    // when the browser goes away rejects, and that would surface instead of whatever ended the run.
    for (const page of pages) await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {})
    await browser.close()
    if (server !== null) await server.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
