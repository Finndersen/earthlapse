#!/usr/bin/env node
/**
 * Standalone browser verification for the two city-marker bug fixes (BUG 1: population-rank
 * culling in the expanded view; BUG 2: first-appearance name labels). Deliberately NOT added to
 * `web/scripts/qa/shots.mjs` — another agent is mid-edit on that shared file this session, and
 * CLAUDE.md's "working in parallel" section says shared-edit files are serialised, not
 * parallelised. This reuses the harness's own read-only building blocks (hook.mjs, measure.mjs,
 * selectors.mjs, timeouts.mjs) against the already-running `next dev` on :3000 instead.
 *
 * Usage: node verify_cities.mjs   (run from anywhere; paths below are absolute)
 */

import path from 'node:path'

import { chromium } from 'playwright'

const QA_DIR = '/Users/finn.andersen/projects/earthview/web/scripts/qa'
const { makeHook, rafTicks } = await import(path.join(QA_DIR, 'hook.mjs'))
const { drawnBoundsInClip, hiddenBoxOf } = await import(path.join(QA_DIR, 'measure.mjs'))
const { GLOBE_MAP_FIT_FRAME_SELECTOR } = await import(path.join(QA_DIR, 'selectors.mjs'))
const { waitForApproxUnfoldProgress } = await import(path.join(QA_DIR, 'timeouts.mjs'))

const BASE_URL = 'http://localhost:3000'

// humanStyle.ts's CITY_COLOR, as sRGB 0-255.
const CITY_RGB = [127, 216, 255]

// Equal Earth projection.ts constants, ported verbatim (pure math, no TS/React needed).
const EE_A1 = 1.340264
const EE_A2 = -0.081106
const EE_A3 = 0.000893
const EE_A4 = 0.003796
const EE_M = Math.sqrt(3) / 2
const DEG2RAD = Math.PI / 180

function lonLatToMap(lon, lat) {
  const lambda = lon * DEG2RAD
  const phi = lat * DEG2RAD
  const theta = Math.asin(EE_M * Math.sin(phi))
  const theta2 = theta * theta
  const theta6 = theta2 * theta2 * theta2
  const x = (lambda * Math.cos(theta)) / (EE_M * (EE_A1 + 3 * EE_A2 * theta2 + theta6 * (7 * EE_A3 + 9 * EE_A4 * theta2)))
  const y = theta * (EE_A1 + EE_A2 * theta2 + theta6 * (EE_A3 + EE_A4 * theta2))
  return [x, y]
}
const HALF_WIDTH = lonLatToMap(180, 0)[0]
const HALF_HEIGHT = lonLatToMap(0, 90)[1]

/** Finds every CITY_RGB-coloured pixel cluster in a screenshot clip. Mirrors the *shape* of
 *  measure.mjs's own scanDrawnPixels (corner-background technique doesn't apply here — we want a
 *  specific hue, not "differs from background"), self-contained for page.evaluate. */
async function findCityClusters(page, clip) {
  const png = await page.screenshot({ clip })
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`
  const local = await page.evaluate(async ({ dataUrl, target }) => {
    const image = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('decode failed'))
      el.src = dataUrl
    })
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(image, 0, 0)
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const THRESHOLD = 70
    const RADIUS = 5
    const clusters = []
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4
        if (data[i + 3] < 180) continue
        const d = Math.abs(data[i] - target[0]) + Math.abs(data[i + 1] - target[1]) + Math.abs(data[i + 2] - target[2])
        if (d >= THRESHOLD) continue
        const existing = clusters.find((c) => Math.hypot(c.cx - x, c.cy - y) < RADIUS)
        if (existing !== undefined) {
          existing.sumX += x
          existing.sumY += y
          existing.n += 1
          existing.cx = existing.sumX / existing.n
          existing.cy = existing.sumY / existing.n
        } else {
          clusters.push({ sumX: x, sumY: y, n: 1, cx: x, cy: y })
        }
      }
    }
    return clusters.map((c) => ({ x: c.cx, y: c.cy, n: c.n }))
  }, { dataUrl, target: CITY_RGB })
  return local.map((c) => ({ x: clip.x + c.x, y: clip.y + c.y, n: c.n }))
}

/**
 * `hook.setT` + settle. A single `rafTicks(page, N)` call chains N `requestAnimationFrame`s
 * inside one `page.evaluate` round trip, which occasionally resolves before React/R3F has
 * actually committed and painted that many frames' worth of state (observed directly: a fresh
 * `Html` label mount took 3-5 real frames to fully settle when driven by *separate* round trips,
 * one tick at a time, each with its own real IPC latency — a single batched `rafTicks(page, 3)`
 * was occasionally one frame short). Several separate single-tick round trips is what reliably
 * settled in that same debugging session, so that's what this uses instead of one larger batch.
 */
async function settleAtT(page, hook, t, ticks = 15) {
  await hook.setT(t)
  for (let i = 0; i < ticks; i += 1) await rafTicks(page, 1)
}

async function main() {
  const browser = await chromium.launch()
  const context = await browser.newContext({ deviceScaleFactor: 1 })
  const page = await context.newPage()
  const consoleErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(String(err)))

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(BASE_URL, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__earthtime !== undefined, undefined, { timeout: 15_000 })
  const hook = makeHook(page)
  await hook.ready()
  await rafTicks(page, 2)

  await hook.setGlobeExpanded(true)
  await hook.setGlobeViewMode('map')
  await waitForApproxUnfoldProgress(page, 1)
  await settleAtT(page, hook, 0)

  const mapBox = await drawnBoundsInClip(page, await hiddenBoxOf(page, GLOBE_MAP_FIT_FRAME_SELECTOR))
  console.log('measured map silhouette box:', mapBox)

  function project(lon, lat) {
    const [x, y] = lonLatToMap(lon, lat)
    return {
      x: mapBox.x + mapBox.width / 2 + (x / HALF_WIDTH) * (mapBox.width / 2),
      y: mapBox.y + mapBox.height / 2 - (y / HALF_HEIGHT) * (mapBox.height / 2),
    }
  }

  // --- Check 1: total city-dot cluster count at modern t, expanded map view ---
  const allClusters = await findCityClusters(page, mapBox)
  console.log(`\n[check 1] total distinct city-coloured pixel clusters at t=0 (expanded map): ${allClusters.length}`)
  console.log('  (old top-45-cap behaviour would never exceed 45; data analysis says all 242 cities exist at t=0)')

  // --- Check 2: specific cities in Africa / Europe / Russia are actually drawn at t=0 ---
  const SPOT_CITIES = [
    { name: 'Cairo', country: 'Egypt (Africa)', lat: 30.06263, lon: 31.24967 },
    { name: 'Lagos', country: 'Nigeria (Africa)', lat: 6.524379, lon: 3.379206 },
    { name: 'Nairobi', country: 'Kenya (Africa)', lat: -1.28333, lon: 36.81667 },
    { name: 'Kinshasa', country: 'DR Congo (Africa)', lat: -4.325, lon: 15.3222 },
    { name: 'London', country: 'UK (Europe)', lat: 51.51121, lon: -0.11983 },
    { name: 'Rome', country: 'Italy (Europe)', lat: 41.89474, lon: 12.4839 },
    { name: 'Lisbon', country: 'Portugal (Europe)', lat: 38.71667, lon: -9.13333 },
    { name: 'Moscow', country: 'Russia', lat: 55.75222, lon: 37.61556 },
  ]
  const SEARCH_RADIUS_PX = 40
  console.log('\n[check 2] specific African / European / Russian cities drawn at t=0:')
  for (const city of SPOT_CITIES) {
    const expected = project(city.lon, city.lat)
    const nearby = allClusters.filter((c) => Math.hypot(c.x - expected.x, c.y - expected.y) <= SEARCH_RADIUS_PX)
    console.log(
      `  ${city.name.padEnd(10)} ${city.country.padEnd(20)} expected~(${expected.x.toFixed(0)},${expected.y.toFixed(0)})  ` +
        `nearby clusters: ${nearby.length}  -> ${nearby.length > 0 ? 'DRAWN' : 'MISSING'}`,
    )
  }

  // --- Check 3: Mexico City stays drawn across a t sweep that previously dropped it ---
  const MEXICO_CITY = { lat: 19.42847, lon: -99.1277 }
  const expectedMC = project(MEXICO_CITY.lon, MEXICO_CITY.lat)
  const SWEEP_T = [525, 400, 300, 200, 150, 125, 100, 75, 50, 25, 0]
  console.log('\n[check 3] Mexico City drawn continuously across a t sweep (bug report: "disappears and re-appears"):')
  let allPresent = true
  for (const t of SWEEP_T) {
    await settleAtT(page, hook, t)
    const clusters = await findCityClusters(page, {
      x: Math.round(expectedMC.x - SEARCH_RADIUS_PX),
      y: Math.round(expectedMC.y - SEARCH_RADIUS_PX),
      width: SEARCH_RADIUS_PX * 2,
      height: SEARCH_RADIUS_PX * 2,
    })
    const present = clusters.length > 0
    allPresent = allPresent && present
    console.log(`  t=${String(t).padStart(4)}  ${present ? 'present' : 'MISSING'}`)
  }
  console.log(`  => Mexico City ${allPresent ? 'stayed drawn at every sampled t' : 'DROPPED OUT at some t — regression!'}`)

  // --- Check 4: first-appearance label (BUG 2) ---
  // Finds our specific label chip (CITY_LABEL_STYLE's own distinctive inline background), not
  // just any occurrence of the city name anywhere on the page (the tooltip, a scene caption,
  // etc.) — avoids both false positives and `innerText`'s layout-dependent blind spots (a drei
  // `Html` portal's zero-size anchor wrapper reads as empty via `innerText`; `textContent`/style
  // inspection do not).
  const findLabel = (name) =>
    page.evaluate(
      (n) =>
        Array.from(document.querySelectorAll('div'))
          .filter((el) => (el.getAttribute('style') ?? '').includes('rgba(3, 4, 6, 0.78)'))
          .some((el) => el.textContent?.trim() === n),
      name,
    )

  console.log('\n[check 4] first-appearance name label:')
  // Mexico City's own oldest estimate is t=525 (its first appearance).
  await settleAtT(page, hook, 525)
  const atFounding = await findLabel('Mexico City')
  console.log(`  at t=525 (exact founding): label chip "Mexico City" present in DOM: ${atFounding}`)

  await settleAtT(page, hook, 525 - 200) // past the fade window (150)
  const pastWindow = await findLabel('Mexico City')
  console.log(`  at t=325 (200 past founding, beyond the 150-t fade window): label present: ${pastWindow} (expect false)`)

  // Scrub back — must reappear (t-driven, not wall-clock).
  await settleAtT(page, hook, 525)
  const scrubbedBack = await findLabel('Mexico City')
  console.log(`  scrubbed back to t=525: label present again: ${scrubbedBack} (expect true — proves it's t-driven, not a timer)`)

  // Orb (not expanded) must never show labels, even at the same t.
  await hook.setGlobeExpanded(false)
  for (let i = 0; i < 15; i += 1) await rafTicks(page, 1)
  const orbHasLabel = await findLabel('Mexico City')
  console.log(`  orb (collapsed) at t=525: label present: ${orbHasLabel} (expect false — labels are expanded-only)`)

  // Back to expanded map for the remaining checks.
  await hook.setGlobeExpanded(true)
  await hook.setGlobeViewMode('map')
  await waitForApproxUnfoldProgress(page, 1)

  const readLabelOpacity = (name) =>
    page.evaluate((n) => {
      const el = Array.from(document.querySelectorAll('div'))
        .filter((e) => (e.getAttribute('style') ?? '').includes('rgba(3, 4, 6, 0.78)'))
        .find((e) => e.textContent?.trim() === n)
      return el === undefined ? null : Number(el.style.opacity)
    }, name)

  await settleAtT(page, hook, 525)
  const mexicoCityLabelOpacity = await readLabelOpacity('Mexico City')
  console.log(`  Mexico City label opacity at its own founding t=525, on-screen map view: ${mexicoCityLabelOpacity} (expect close to 1)`)

  // --- Check 5: Cahokia (BUG 1.5 — coordinator correction, "cities that ceased to exist") ---
  console.log('\n[check 5] trailing-grace fix — a city whose own record ended must stop being drawn:')
  const CAHOKIA = { lat: 38.57088, lon: -90.19011 } // real published coordinates
  const expectedCahokia = project(CAHOKIA.lon, CAHOKIA.lat)
  // Chicago sits only ~18px away at this map scale (its own published coordinates) and is always
  // present, so a pixel-colour-cluster search near Cahokia's own approximate position is
  // ambiguous between the two. Hovering instead and reading back the app's OWN hit-tested tooltip
  // title (GlobeTooltip.tsx's real 3D projection + nearest-candidate scoring, not this script's
  // approximate Equal Earth port) removes that ambiguity entirely — whichever city's tooltip
  // actually names itself "Cahokia" settles it, immune to this script's own calibration error. A
  // small local grid search around the approximate point finds the exact sub-pixel offset.
  async function tooltipTitleNear(x, y, radius = 20, step = 4) {
    for (let dy = -radius; dy <= radius; dy += step) {
      for (let dx = -radius; dx <= radius; dx += step) {
        await page.mouse.move(x + dx, y + dy)
        await rafTicks(page, 1)
        const title = await page.evaluate(() => {
          const el = document.querySelector('[data-testid="globe-tooltip"] p')
          return el === null ? null : el.textContent
        })
        if (title !== null) return title
      }
    }
    return null
  }

  // Real published Cahokia estimates: {t:625, pop:4000}, {t:925, pop:40000} — newest is t=625
  // (~1400 CE), oldest is t=925 (~1100 CE).
  await settleAtT(page, hook, 25) // present
  const titleAtPresent = await tooltipTitleNear(expectedCahokia.x, expectedCahokia.y)
  console.log(
    `  at t=25 (present): hovering near Cahokia's own location finds "${titleAtPresent}" (expect NOT "Cahokia" — its own record ended ~1400 CE; "Chicago" or null is correct)`,
  )

  await settleAtT(page, hook, 625) // Cahokia's own newest reading
  const titleAtNewest = await tooltipTitleNear(expectedCahokia.x, expectedCahokia.y)
  console.log(`  at t=625 (its own newest/last-attested reading): hovering near Cahokia's own location finds "${titleAtNewest}" (expect "Cahokia")`)

  const MEMPHIS = { lat: 29.844722, lon: 31.250833 }
  const expectedMemphis = project(MEMPHIS.lon, MEMPHIS.lat)
  await settleAtT(page, hook, 25)
  const memphisClusters = await findCityClusters(page, {
    x: Math.round(expectedMemphis.x - SEARCH_RADIUS_PX),
    y: Math.round(expectedMemphis.y - SEARCH_RADIUS_PX),
    width: SEARCH_RADIUS_PX * 2,
    height: SEARCH_RADIUS_PX * 2,
  })
  console.log(
    `  at t=25 (present): Memphis dot drawn: ${memphisClusters.length > 0} (expect true — its newest reading, t=50, sits at the dataset's own trailing edge)`,
  )

  // Cahokia's own label (first appearance, oldest estimate t=925).
  await settleAtT(page, hook, 925)
  const cahokiaLabelAtFounding = await findLabel('Cahokia')
  console.log(`  Cahokia label at its own first-appearance t=925: present: ${cahokiaLabelAtFounding} (expect true)`)

  await settleAtT(page, hook, 25)
  const cahokiaLabelAtPresent = await findLabel('Cahokia')
  console.log(`  Cahokia label at t=25 (present, long since both faded and non-existent): present: ${cahokiaLabelAtPresent} (expect false)`)

  console.log(`\nconsole/page errors seen: ${consoleErrors.length}`)
  for (const e of consoleErrors) console.log(`  - ${e}`)

  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
