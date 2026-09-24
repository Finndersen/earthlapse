/**
 * Pixel measurement primitives for the visual-QA harness. Every function here returns numbers
 * in device-independent (CSS) pixels — the harness always creates the browser context with
 * `deviceScaleFactor: 1` (see `run.mjs`), so a screenshot's pixel grid already equals the page's
 * CSS pixel grid and no further conversion is needed.
 *
 * `drawnBounds` is the one that actually answers "what did the user's eye land on" — it scans
 * real rendered pixels, not layout. `boxOf` answers a different, narrower question (the element's
 * CSS box) and is named to make sure nobody reaches for it expecting the former: measuring a
 * `<canvas>`'s CSS box tells you the box the app *asked* the canvas to fill, not what got drawn
 * inside it — conflating the two is exactly the regression this harness exists to catch (see
 * this package's README).
 *
 * Cost model: with the expanded globe on screen every page round trip and every screenshot waits
 * out a software-rendered frame (100-500 ms here), so screenshots come from `capturePng` and
 * pixels are decoded and scanned in Node (`capturePixels`), never handed back to the page.
 */

import { inflateSync } from 'node:zlib'

/**
 * @typedef {{x: number, y: number, width: number, height: number}} PixelBox
 * @typedef {PixelBox & { fractionOfViewport: number }} DrawnBounds
 * @typedef {{ width: number, height: number, data: Uint8Array }} Pixels RGBA, row-major
 */

/**
 * The bounding box of the actually-drawn (non-background) pixels inside the first element
 * matching `selector`. Works for a `<canvas>` (WebGL or 2D) or any other element — it never
 * inspects the DOM/CSS, only a screenshot of the element's own box.
 *
 * Method: screenshot the element's box, sample the four corners as the background colour, and
 * find the bounding rect of pixels whose summed per-channel difference from that background
 * exceeds `threshold`.
 *
 * @param {import('playwright').Page} page
 * @param {string} selector
 * @param {{ threshold?: number }} [options] `threshold` (default 24, summed across R+G+B+A) is
 *   how far a pixel must sit from the sampled background before it counts as "drawn" — high
 *   enough to ignore antialiasing/compression noise at a flat edge, low enough to catch a dim
 *   scene against a near-black backdrop.
 * @returns {Promise<DrawnBounds>} `x`/`y` are page-absolute; `width`/`height` are 0 when nothing
 *   in the element differs from its own background (e.g. a canvas that never painted).
 */
export async function drawnBounds(page, selector, { threshold = 24 } = {}) {
  return drawnBoundsInClip(page, await paintedBoxOf(page, selector), { threshold })
}

/**
 * `boxOf`'s box, once the element is visible (as Playwright defines it: a non-empty box, not
 * `visibility: hidden`) and two more animation frames have painted it, in one round trip: a
 * capture takes the last frame drawn rather than waiting for one.
 * @param {import('playwright').Page} page
 * @param {string} selector
 * @returns {Promise<PixelBox>}
 */
async function paintedBoxOf(page, selector) {
  const box = await page.evaluate(async (sel) => {
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve))
    const visibleBox = () => {
      const el = document.querySelector(sel)
      if (el === null || getComputedStyle(el).visibility === 'hidden') return null
      const rect = el.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0 ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null
    }
    const deadline = performance.now() + 30_000
    while (visibleBox() === null) {
      if (performance.now() > deadline) return null
      await nextFrame()
    }
    await nextFrame()
    await nextFrame()
    return visibleBox()
  }, selector)
  if (box === null) throw new Error(`drawnBounds: "${selector}" never became visible`)
  return box
}

/**
 * `drawnBounds`'s own pixel scan, over an explicit page-absolute `clip` rectangle instead of a
 * selector's own bounding box: for an element whose CSS box is much bigger than the region worth
 * scanning, such as the expanded globe's full-viewport `<canvas>`, whose box also holds the
 * "Globe/Map" toggle, the legend, the close button and the zoom controls. `clip`'s coordinates
 * are page-absolute CSS pixels, matching `boundingBox()`'s own.
 * @param {import('playwright').Page} page
 * @param {PixelBox} clip
 * @param {{ threshold?: number }} [options]
 * @returns {Promise<DrawnBounds>}
 */
export async function drawnBoundsInClip(page, clip, { threshold = 24 } = {}) {
  const roundedClip = roundClip(clip)
  if (roundedClip.width === 0 || roundedClip.height === 0) {
    return { x: roundedClip.x, y: roundedClip.y, width: 0, height: 0, fractionOfViewport: 0 }
  }

  const local = scanDrawnPixels(await capturePixels(page, roundedClip), threshold)

  const viewport = page.viewportSize()
  const viewportArea = viewport === null ? 1 : viewport.width * viewport.height
  return {
    x: roundedClip.x + local.x,
    y: roundedClip.y + local.y,
    width: local.width,
    height: local.height,
    fractionOfViewport: (local.width * local.height) / viewportArea,
  }
}

/** `clip` on whole CSS pixels, as a screenshot takes it. */
export const roundClip = (clip) => ({ x: Math.round(clip.x), y: Math.round(clip.y), width: Math.round(clip.width), height: Math.round(clip.height) })

const cdpSessions = new WeakMap()

/** The page's one CDP session, opened on first use.
 * @param {import('playwright').Page} page
 * @returns {Promise<import('playwright').CDPSession>} */
export function cdpSession(page) {
  if (!cdpSessions.has(page)) cdpSessions.set(page, page.context().newCDPSession(page))
  return cdpSessions.get(page)
}

/**
 * A PNG of the viewport from CDP's `Page.captureScreenshot` with `optimizeForSpeed` — lossless,
 * lightly compressed. That is 3-5x faster here than `page.screenshot`, which spends most of its
 * time in a full-strength PNG encode plus page round trips of its own (scroll offset, caret
 * hiding); `run.mjs` hides the caret once per page instead. Always the whole viewport: a `clip`
 * makes Chromium swap this session's device-metrics emulation in for the capture, which undoes
 * Playwright's viewport for the page's later resizes (`capturePixels` crops instead). It captures
 * the last frame drawn, so whatever changed the page must have waited a couple of animation
 * frames first (`rafTicks`, `hook.ready()`, or a helper's own).
 * @param {import('playwright').Page} page
 * @returns {Promise<Buffer>}
 */
export async function capturePng(page) {
  const started = Date.now()
  const cdp = await cdpSession(page)
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true })
  // `run.mjs`'s per-shot call timings, when it is recording them.
  if (page.qaCallTimings !== undefined) {
    const entry = (page.qaCallTimings.capture ??= { n: 0, ms: 0 })
    entry.n += 1
    entry.ms += Date.now() - started
  }
  return Buffer.from(data, 'base64')
}

/**
 * The RGBA pixels of the viewport, or of `clip` (viewport CSS px, rounded) within it: what every
 * pixel measurement in this harness reads, decoded in Node so it needs no npm image library and
 * costs the busy page nothing.
 * @param {import('playwright').Page} page
 * @param {PixelBox} [clip]
 * @returns {Promise<Pixels>}
 */
export async function capturePixels(page, clip) {
  const image = decodePng(await capturePng(page))
  if (clip === undefined) return image
  const { x, y, width, height } = roundClip(clip)
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > image.width || y + height > image.height) {
    throw new Error(`capturePixels: clip ${JSON.stringify(clip)} is not inside the ${image.width}x${image.height} viewport`)
  }
  const data = new Uint8Array(width * height * 4)
  for (let row = 0; row < height; row += 1) {
    const from = ((y + row) * image.width + x) * 4
    data.set(image.data.subarray(from, from + width * 4), row * width * 4)
  }
  return { width, height, data }
}

/**
 * RGBA pixels of an 8-bit, non-interlaced RGB or RGBA PNG — what Chromium's screenshots are.
 * Throws on anything else rather than misreading it.
 * @param {Buffer} png
 * @returns {Pixels}
 */
function decodePng(png) {
  let width = 0
  let height = 0
  let channels = 0
  const idat = []
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset)
    const type = png.toString('ascii', offset + 4, offset + 8)
    const body = png.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      const [bitDepth, colorType, , , interlace] = body.subarray(8, 13)
      channels = { 2: 3, 6: 4 }[colorType] ?? 0
      if (bitDepth !== 8 || channels === 0 || interlace !== 0) {
        throw new Error(`decodePng: unsupported PNG (bit depth ${bitDepth}, colour type ${colorType}, interlace ${interlace})`)
      }
    } else if (type === 'IDAT') {
      idat.push(body)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const data = new Uint8Array(width * height * 4)
  let previous = new Uint8Array(stride)
  let current = new Uint8Array(stride)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? current[i - channels] : 0
      const up = previous[i]
      let predictor = 0
      if (filter === 1) predictor = left
      else if (filter === 2) predictor = up
      else if (filter === 3) predictor = (left + up) >> 1
      else if (filter === 4) {
        const upLeft = i >= channels ? previous[i - channels] : 0
        const p = left + up - upLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upLeft)
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
      }
      current[i] = (line[i] + predictor) & 0xff
    }
    for (let x = 0; x < width; x += 1) {
      const out = (y * width + x) * 4
      const src = x * channels
      data[out] = current[src]
      data[out + 1] = current[src + 1]
      data[out + 2] = current[src + 2]
      data[out + 3] = channels === 4 ? current[src + 3] : 255
    }
    ;[previous, current] = [current, previous]
  }
  return { width, height, data }
}

/**
 * The bounding box of pixels whose summed RGBA difference from the image's averaged four corners
 * exceeds `threshold`, `width`/`height` 0 when none does.
 * @param {Pixels} image
 * @param {number} threshold
 * @returns {PixelBox}
 */
function scanDrawnPixels({ data, width, height }, threshold) {
  const at = (x, y) => (y * width + x) * 4
  const corners = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ]
  const bg = [0, 0, 0, 0]
  for (const [cx, cy] of corners) for (let c = 0; c < 4; c += 1) bg[c] += data[at(cx, cy) + c] / corners.length

  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = at(x, y)
      const diff =
        Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) + Math.abs(data[i + 3] - bg[3])
      if (diff > threshold) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < minX || maxY < minY) return { x: 0, y: 0, width: 0, height: 0 }
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

/**
 * The plain CSS box of the first element matching `selector`, once it is visible —
 * `getBoundingClientRect`, nothing more. See this module's own doc comment for why this must
 * never stand in for `drawnBounds`.
 * @param {import('playwright').Page} page
 * @param {string} selector
 * @returns {Promise<PixelBox>}
 */
export async function boxOf(page, selector) {
  const locator = page.locator(selector).first()
  await locator.waitFor({ state: 'visible' })
  const box = await locator.boundingBox()
  if (box === null) throw new Error(`boxOf: "${selector}" has no box (display:none?)`)
  return { x: box.x, y: box.y, width: box.width, height: box.height }
}

/**
 * The plain layout box of the first element matching `selector`, read via a direct
 * `getBoundingClientRect()` rather than `locator.boundingBox()` — the latter first waits for
 * Playwright's "visible" actionability state, which a deliberately `visibility: hidden` element
 * (`Globe.tsx`'s `.orbFitFrameSphere`/`.orbFitFrameMap` — real geometry probes, never painted)
 * never reaches. `visibility: hidden` still lays out normally (unlike `display: none`), so this
 * still returns a real box. Throws if the element isn't in the DOM at all, the one case
 * `getBoundingClientRect` can't distinguish from a genuine zero-size box on its own.
 * @param {import('playwright').Page} page
 * @param {string} selector
 * @returns {Promise<PixelBox>}
 */
export async function hiddenBoxOf(page, selector) {
  const box = await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (el === null) return null
    const rect = el.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  }, selector)
  if (box === null) throw new Error(`hiddenBoxOf: "${selector}" not found in the DOM`)
  return box
}

/**
 * Vertical free space between two elements' *drawn* content (not their CSS boxes) — positive
 * when they don't overlap, negative when they do (the magnitude of the overlap).
 * @param {import('playwright').Page} page
 * @param {string} selectorA
 * @param {string} selectorB
 * @param {{ threshold?: number }} [options]
 * @returns {Promise<number>}
 */
export async function gapBetween(page, selectorA, selectorB, options) {
  const [a, b] = await Promise.all([drawnBounds(page, selectorA, options), drawnBounds(page, selectorB, options)])
  const aBottom = a.y + a.height
  const bBottom = b.y + b.height
  if (aBottom <= b.y) return b.y - aBottom
  if (bBottom <= a.y) return a.y - bBottom
  return -(Math.min(aBottom, bBottom) - Math.max(a.y, b.y))
}
