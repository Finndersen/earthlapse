/**
 * Node-side wrapper around `window.__earthlapse` (`web/src/store/devHook.ts`) — every call here
 * is a `page.evaluate` round trip, so shots never need to know that detail. Mirrors the hook's
 * own method names exactly.
 */

/**
 * @param {import('playwright').Page} page
 */
export function makeHook(page) {
  const hook = {
    /** `Date.now()` of the last `setT` through this wrapper — `run.mjs` reads it to tell whether a
     *  scene crossfade a shot started may still be running when the next shot begins. */
    lastSetTAt: 0,
    /** @param {number} t */
    setT: async (t) => {
      hook.lastSetTAt = Date.now()
      await page.evaluate((value) => window.__earthlapse?.setT(value), t)
    },
    getState: () => page.evaluate(() => window.__earthlapse?.getState()),
    /** @param {boolean} playing */
    setPlaying: (playing) => page.evaluate((value) => window.__earthlapse?.setPlaying(value), playing),
    /** @param {'scenes' | 'steady'} mode */
    setPlaybackMode: (mode) => page.evaluate((value) => window.__earthlapse?.setPlaybackMode(value), mode),
    /** @param {string} id */
    selectSection: (id) => page.evaluate((value) => window.__earthlapse?.selectSection(value), id),
    /** @param {boolean} expanded */
    setGlobeExpanded: (expanded) => page.evaluate((value) => window.__earthlapse?.setGlobeExpanded(value), expanded),
    getGlobeViewMode: () => page.evaluate(() => window.__earthlapse?.getGlobeViewMode() ?? null),
    /** @param {'globe' | 'map'} mode */
    setGlobeViewMode: (mode) => page.evaluate((value) => window.__earthlapse?.setGlobeViewMode(value), mode),
    /** Opens the first-visit tour, or dismisses it and records it as seen — see `devHook.ts`.
     * @param {boolean} open */
    setTourOpen: (open) => page.evaluate((value) => window.__earthlapse?.setTourOpen(value), open),
    /**
     * @param {string} key
     * @param {boolean} on
     */
    setLayerToggle: (key, on) => page.evaluate(([k, v]) => window.__earthlapse?.setLayerToggle(k, v), [key, on]),
    /** Resolves once the manifest is loaded and every image/texture load this run has seen has
     *  settled — see `devHook.ts`'s own doc comment for exactly what that covers. */
    ready: () => page.evaluate(() => window.__earthlapse?.ready()),
  }
  return hook
}

/**
 * Waits for `count` real animation frames — used after `hook.ready()` to give a just-loaded
 * texture a chance to actually paint, and after any DOM-driven action (`hook.setGlobeViewMode`,
 * a legend click) before a screenshot. Never a substitute for `ready()`: this is a fixed, small
 * number of frames, not a condition.
 * @param {import('playwright').Page} page
 * @param {number} count
 */
export function rafTicks(page, count) {
  return page.evaluate(
    (n) =>
      new Promise((resolve) => {
        let remaining = n
        const tick = () => {
          remaining -= 1
          if (remaining <= 0) resolve(undefined)
          else requestAnimationFrame(tick)
        }
        if (n <= 0) resolve(undefined)
        else requestAnimationFrame(tick)
      }),
    count,
  )
}

/**
 * Waits until the expanded globe's two fit-frame rectangles (`Globe.tsx`'s `.orbFitFrameSphere`/
 * `.orbFitFrameMap`, which `GlobeCameraControls` fits the camera to) have held the same geometry
 * for `stableFrames` consecutive animation frames. After an expand they arrive a few renders late
 * (`useChromeGap`, then the fit-frame measurement), and the camera snaps to them on the frame they
 * land, so a stable pair is the signal that the expanded layout has converged.
 * @param {import('playwright').Page} page
 * @param {{ stableFrames?: number, timeoutMs?: number }} [options]
 */
export function waitForGlobeFitFramesStable(page, { stableFrames = 3, timeoutMs = 3000 } = {}) {
  return page.evaluate(
    async ({ stableFrames: needed, timeoutMs: limit }) => {
      const read = () =>
        ['[data-testid="globe-sphere-fit-frame"]', '[data-testid="globe-map-fit-frame"]']
          .map((sel) => {
            const r = document.querySelector(sel)?.getBoundingClientRect()
            return r === undefined ? 'none' : `${r.x},${r.y},${r.width},${r.height}`
          })
          .join('|')
      const start = performance.now()
      let last = read()
      let stable = 0
      while (stable < needed && performance.now() - start < limit) {
        await new Promise((resolve) => requestAnimationFrame(resolve))
        const current = read()
        stable = current === last ? stable + 1 : 0
        last = current
      }
    },
    { stableFrames, timeoutMs },
  )
}
