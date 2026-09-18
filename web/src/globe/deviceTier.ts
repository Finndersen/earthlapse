/**
 * "Phone" viewport detection and basemap tier selection for the human-era globe base (ADR-030):
 * T0 for the minimised orb and for phone-expanded; T1 only when expanded on desktop.
 *
 * "Phone" (`useIsPhoneViewport` below) is this package's own name for `@/lib/
 * useIsCompactViewport`'s `(max-width: 760px)` query — see that module's own doc comment for why
 * this is a re-export rather than a second, independent implementation.
 */

export { useIsCompactViewport as useIsPhoneViewport } from '@/lib/useIsCompactViewport'

/** T1 is 4096px square-ish — a device whose WebGL implementation caps texture size below that
 *  (rare, but real on some older/integrated GPUs) must fall back to T0 regardless of viewport
 *  or expanded state, or the upload would simply fail. Pure: `maxTextureSize` should come from
 *  `probeWebgl()` (`lib/webgl.ts`), read once per mount alongside `supportsWebGL()`'s own
 *  check — `Globe.tsx` calls `probeWebgl()` exactly once and reads both `.supported` and
 *  `.maxTextureSize` from the same result, rather than this function opening a *second*
 *  throwaway canvas/context purely to ask the GPU the same kind of question. */
export function supportsBasemapT1(maxTextureSize: number): boolean {
  return maxTextureSize >= 4096
}

export type BasemapTier = 'basemap_t0' | 'basemap_t1'

/**
 * Pure tier decision: T0 for the minimised orb (every device) and for a
 * phone's expanded view; T1 only expanded on a non-phone device whose GPU can hold it.
 * `t1Available` should come from `supportsBasemapT1()`, read once and passed in — kept as a
 * plain boolean argument (rather than called here) so this function stays pure and unit
 * testable without a DOM/WebGL context, the same split `Globe.tsx` already makes for
 * `supportsWebGL()`.
 */
export function selectBasemapTier(expanded: boolean, isPhone: boolean, t1Available: boolean): BasemapTier {
  return expanded && !isPhone && t1Available ? 'basemap_t1' : 'basemap_t0'
}
