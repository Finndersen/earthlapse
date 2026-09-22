/**
 * Node-side wrapper around `window.__earthtime` (`web/src/store/devHook.ts`) — every call here
 * is a `page.evaluate` round trip, so shots never need to know that detail. Mirrors the hook's
 * own method names exactly.
 */

/**
 * @param {import('playwright').Page} page
 */
export function makeHook(page) {
  return {
    /** @param {number} t */
    setT: (t) => page.evaluate((value) => window.__earthtime?.setT(value), t),
    getState: () => page.evaluate(() => window.__earthtime?.getState()),
    /** @param {boolean} playing */
    setPlaying: (playing) => page.evaluate((value) => window.__earthtime?.setPlaying(value), playing),
    /** @param {'scenes' | 'steady'} mode */
    setPlaybackMode: (mode) => page.evaluate((value) => window.__earthtime?.setPlaybackMode(value), mode),
    /** @param {string} id */
    selectSection: (id) => page.evaluate((value) => window.__earthtime?.selectSection(value), id),
    /** @param {boolean} expanded */
    setGlobeExpanded: (expanded) => page.evaluate((value) => window.__earthtime?.setGlobeExpanded(value), expanded),
    getGlobeViewMode: () => page.evaluate(() => window.__earthtime?.getGlobeViewMode() ?? null),
    /** @param {'globe' | 'map'} mode */
    setGlobeViewMode: (mode) => page.evaluate((value) => window.__earthtime?.setGlobeViewMode(value), mode),
    /** Opens the first-visit tour, or dismisses it and records it as seen — see `devHook.ts`.
     * @param {boolean} open */
    setTourOpen: (open) => page.evaluate((value) => window.__earthtime?.setTourOpen(value), open),
    /**
     * @param {string} key
     * @param {boolean} on
     */
    setLayerToggle: (key, on) => page.evaluate(([k, v]) => window.__earthtime?.setLayerToggle(k, v), [key, on]),
    /** Resolves once the manifest is loaded and every image/texture load this run has seen has
     *  settled — see `devHook.ts`'s own doc comment for exactly what that covers. */
    ready: () => page.evaluate(() => window.__earthtime?.ready()),
  }
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
