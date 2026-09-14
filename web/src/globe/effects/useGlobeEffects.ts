'use client'

/**
 * Thin memoised wrapper around `resolveGlobeEffects` — the drop-in for `Globe.tsx`, mirroring
 * how it already wraps `globeBlendAt` in a `useMemo` for the same reason (`t`/inputs change on
 * every playback frame; the shader only needs a new value when they actually do).
 */

import { useMemo } from 'react'

import type { GeoTime, TimelineEvent } from '@/types/layer'

import { resolveGlobeEffects, type ResolvedGlobeEffects } from './resolve'

export function useGlobeEffects(
  t: GeoTime,
  regimeEvents: readonly TimelineEvent[],
  effectEvents: readonly TimelineEvent[],
  fallbackCaption = '',
): ResolvedGlobeEffects {
  return useMemo(
    () => resolveGlobeEffects(t, regimeEvents, effectEvents, fallbackCaption),
    [t, regimeEvents, effectEvents, fallbackCaption],
  )
}
