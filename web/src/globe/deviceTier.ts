/**
 * "Phone" viewport detection, and basemap tier selection for the human-era globe base (ADR-030):
 * T0 for the minimised orb, T1 once expanded on any device whose GPU can hold it.
 *
 * "Phone" (`useIsPhoneViewport` below) is this package's own name for `@/lib/
 * useIsCompactViewport`'s `(max-width: 760px)` query — see that module's own doc comment for why
 * this is a re-export rather than a second, independent implementation. Still used elsewhere in
 * `web/src/globe/` for phone-specific chrome layout, even though tier selection itself no longer
 * branches on it.
 */

export { useIsCompactViewport as useIsPhoneViewport } from '@/lib/useIsCompactViewport'

/** T1 is 4096px square-ish, so a device whose WebGL implementation caps texture size below that
 *  (real on some older/integrated GPUs) must fall back to T0 or the upload fails. `maxTextureSize`
 *  comes from `probeWebgl()` (`lib/webgl.ts`), which `Globe.tsx` calls exactly once per mount for
 *  both `.supported` and `.maxTextureSize` — this stays a pure function rather than opening a
 *  second throwaway canvas/context to ask the GPU the same question. */
export function supportsBasemapT1(maxTextureSize: number): boolean {
  return maxTextureSize >= 4096
}

export type BasemapTier = 'basemap_t0' | 'basemap_t1'

/**
 * Pure tier decision: T0 for the minimised orb (every device); T1 once expanded, on any device
 * whose GPU can hold it (`t1Available`, from `supportsBasemapT1()`) — a phone included, since at
 * the ~48° longitude visible across a ~1080px-wide phone screen T0 is only a ~4x upscale of its
 * source pixels against T1's ~2x (docs/GLOBE.md §10, ADR-030's amendment). Passed in as a plain
 * boolean so this stays unit-testable without a DOM/WebGL context — the same split `Globe.tsx`
 * makes for `supportsWebGL()`.
 */
export function selectBasemapTier(expanded: boolean, t1Available: boolean): BasemapTier {
  return expanded && t1Available ? 'basemap_t1' : 'basemap_t0'
}
