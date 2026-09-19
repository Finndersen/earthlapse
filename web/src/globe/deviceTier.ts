/**
 * "Phone" viewport detection and basemap tier selection for the human-era globe base (ADR-030):
 * T0 for the minimised orb and for phone-expanded; T1 only when expanded on desktop.
 *
 * "Phone" (`useIsPhoneViewport` below) is this package's own name for `@/lib/
 * useIsCompactViewport`'s `(max-width: 760px)` query — see that module's own doc comment for why
 * this is a re-export rather than a second, independent implementation.
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
 * Pure tier decision: T0 for the minimised orb (every device) and for a phone's expanded view;
 * T1 only expanded on a non-phone device whose GPU can hold it. `t1Available` comes from
 * `supportsBasemapT1()` and is passed in as a plain boolean so this stays unit-testable without
 * a DOM/WebGL context — the same split `Globe.tsx` makes for `supportsWebGL()`.
 */
export function selectBasemapTier(expanded: boolean, isPhone: boolean, t1Available: boolean): BasemapTier {
  return expanded && !isPhone && t1Available ? 'basemap_t1' : 'basemap_t0'
}
