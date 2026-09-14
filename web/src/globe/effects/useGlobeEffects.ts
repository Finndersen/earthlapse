'use client'

/**
 * The drop-in for `Globe.tsx`: memoises `resolveGlobeEffects`'s pure target (`t`/inputs change
 * on every playback frame; the shader only needs a new value when they actually do), then
 * rate-limits its `uniforms` toward what is actually displayed via `usePresentedGlobeEffectUniforms`
 * (`presentation.ts`) — the wall-clock floor that keeps a fast scrub or playback tick from
 * snapping the ice shell, impact veil/flash or regime blend instead of fading them
 * (docs/GLOBE.md §4.3). `caption` passes through unrated (see that module's doc comment).
 */

import { useMemo } from 'react'

import type { GeoTime, TimelineEvent } from '@/types/layer'

import { usePresentedGlobeEffectUniforms } from './presentation'
import { resolveGlobeEffects, type ResolvedGlobeEffects } from './resolve'

export function useGlobeEffects(
  t: GeoTime,
  regimeEvents: readonly TimelineEvent[],
  effectEvents: readonly TimelineEvent[],
  fallbackCaption = '',
): ResolvedGlobeEffects {
  const target = useMemo(
    () => resolveGlobeEffects(t, regimeEvents, effectEvents, fallbackCaption),
    [t, regimeEvents, effectEvents, fallbackCaption],
  )
  const uniforms = usePresentedGlobeEffectUniforms(target.uniforms)
  return { uniforms, caption: target.caption }
}
