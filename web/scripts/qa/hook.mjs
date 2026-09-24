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
    /** `setT` only when the store holds a different `t`, in one round trip; whether it did.
     * @param {number} t */
    setTIfChanged: async (t) => {
      const changed = await page.evaluate((value) => {
        const qa = window.__earthlapse
        if (qa?.getState().t === value) return false
        qa?.setT(value)
        return true
      }, t)
      if (changed) hook.lastSetTAt = Date.now()
      return changed
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
    /**
     * Calls the hook's `method` with `args`, then waits `frames` animation frames, in one round
     * trip: a toggle and the frames that paint it cost one software-rendered frame's wait, not two.
     * @param {string} method
     * @param {unknown[]} args
     * @param {number} frames
     */
    callThenFrames: (method, args, frames) =>
      page.evaluate(
        async ([name, values, count]) => {
          window.__earthlapse[name](...values)
          for (let i = 0; i < count; i += 1) await new Promise((resolve) => requestAnimationFrame(resolve))
        },
        [method, args, frames],
      ),
  }
  return hook
}

/**
 * Waits `frames` animation frames for a pointer move or click to land, then returns `read`
 * evaluated in the page — one round trip instead of `rafTicks` plus a separate read. Three by
 * default: after two, a globe tooltip can still show the previous pointer position's hit.
 * @template T
 * @param {import('playwright').Page} page
 * @param {(arg: any) => T} read self-contained: it runs in the page from its source
 * @param {unknown} [arg]
 * @param {number} [frames]
 * @returns {Promise<T>}
 */
export function afterFrames(page, read, arg, frames = 3) {
  return page.evaluate(
    async ({ source, value, count }) => {
      for (let i = 0; i < count; i += 1) await new Promise((resolve) => requestAnimationFrame(resolve))
      return new Function(`return (${source})`)()(value)
    },
    { source: read.toString(), value: arg, count: frames },
  )
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
 * @returns {Promise<Record<"sphere" | "map", { x: number, y: number, width: number, height: number } | null>>} the frames as they
 *   settled (`null` when absent), so a caller needs no round trip of its own to read them.
 */
export function waitForGlobeFitFramesStable(page, { stableFrames = 3, timeoutMs = 3000 } = {}) {
  return page.evaluate(
    async ({ stableFrames: needed, timeoutMs: limit }) => {
      const rects = () => ({
        sphere: document.querySelector('[data-testid="globe-sphere-fit-frame"]')?.getBoundingClientRect().toJSON() ?? null,
        map: document.querySelector('[data-testid="globe-map-fit-frame"]')?.getBoundingClientRect().toJSON() ?? null,
      })
      const key = ({ sphere, map }) => [sphere, map].map((r) => (r === null ? 'none' : `${r.x},${r.y},${r.width},${r.height}`)).join('|')
      const start = performance.now()
      let last = rects()
      let stable = 0
      while (stable < needed && performance.now() - start < limit) {
        await new Promise((resolve) => requestAnimationFrame(resolve))
        const current = rects()
        stable = key(current) === key(last) ? stable + 1 : 0
        last = current
      }
      return last
    },
    { stableFrames, timeoutMs },
  )
}
