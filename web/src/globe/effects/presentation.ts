'use client'

/**
 * Wall-clock presentation limiter for the globe's effect intensities (docs/GLOBE.md §4.3,
 * user follow-up: "the snowball representation... seems glitchy, should ideally have a more
 * gradual transition"). `resolveGlobeEffects`'s `uniforms` stay pure in `t` — `overlays.ts` and
 * `regimes.ts` already ease every window/crossfade edge at a constant width in the timeline's
 * symlog warp space rather than a fixed number of years (`math.ts`'s `symlogWarp`) — but a
 * fixed span of warped `t` still says nothing about how much *wall-clock* time elapses crossing
 * it: a fast scrub or a playback tick at high speed can cross a whole ease band in a handful of
 * milliseconds, which reads as a snap regardless of how the band itself is sized. This module
 * rate-limits what is *displayed* toward that target instead.
 *
 * It reuses `lib/presentedMix.ts`'s `usePresentedNumericRecord` — the same generalisation of
 * the ancestor portrait's `usePresentedMix`/`MIN_PORTRAIT_TRANSITION_SECONDS`
 * (`layers/portraits.ts`) — rather than a third copy of the rate-limiting loop. Every one of
 * `iceShell`, `impactWinterVeil`, `impactFlash`, `giantImpactFlash` and the four `regimeWeights`
 * fields is moved toward its target independently, by at most `dt / MIN_EFFECT_TRANSITION_SECONDS`
 * per wall-clock second, so a full 0 -> 1 change in any one of them never completes in under
 * that floor however fast `t` itself jumps; a target moving slower than the floor on its own
 * (ordinary playback, a slow scrub) is simply followed exactly.
 *
 * `impactFlashAnchorUv` is not itself numeric and is handled separately (`heldAnchor` below):
 * the anchor is a static fact about the event (Chicxulub's fixed lat/lon), not something to
 * ease, but `resolveGlobeEffects` nulls it the instant its *raw* (un-rate-limited) veil/flash
 * both reach 0 — which can happen before the *presented* (rate-limited) intensities have
 * finished decaying. Nulling the anchor then would point the shader's still-visible flash glow
 * at `NO_ANCHOR_UV` (`Globe.tsx`) instead of Chicxulub. `heldAnchor` keeps the last non-null
 * anchor on screen for exactly as long as the presented flash/veil still need it.
 *
 * Reduced motion: `usePresentedMix` (the pattern this generalises) does not itself check
 * `prefers-reduced-motion` — the ancestor portrait's morph runs at the same rate regardless
 * (`AncestorPortrait.tsx` never reads it) — so this module doesn't either, matching that
 * precedent rather than inventing a new one.
 */

import { useState } from 'react'

import { usePresentedNumericRecord } from '@/lib/presentedMix'

import type { AnchorUv } from './overlays'
import type { GlobeEffectUniforms } from './resolve'

/** However fast `t` moves, a full 0 -> 1 change in any effect intensity takes at least this
 *  long on screen (docs/GLOBE.md §4.3's "more gradual transition"). Shorter than the scene's
 *  1.6 s (`scene/presentation.ts`'s `MIN_TRANSITION_SECONDS`) and a touch longer than the
 *  ancestor portrait's 1.2 s (`layers/portraits.ts`'s `MIN_PORTRAIT_TRANSITION_SECONDS`): the
 *  globe fills more of the frame than either and reads best as a deliberate fade, not a quick
 *  cut. */
export const MIN_EFFECT_TRANSITION_SECONDS = 1.5

/** The subset of `GlobeEffectUniforms` that is plain numbers, flattened to one record so
 *  `usePresentedNumericRecord` can rate-limit every field with a single rAF loop. */
interface EffectIntensities {
  iceShell: number
  impactWinterVeil: number
  impactFlash: number
  giantImpactFlash: number
  regimeMagmaOcean: number
  regimeWaterWorld: number
  regimeArchean: number
  regimeUnknownGeography: number
}

function toIntensities(uniforms: GlobeEffectUniforms): EffectIntensities {
  return {
    iceShell: uniforms.iceShell,
    impactWinterVeil: uniforms.impactWinterVeil,
    impactFlash: uniforms.impactFlash,
    giantImpactFlash: uniforms.giantImpactFlash,
    regimeMagmaOcean: uniforms.regimeWeights.magmaOcean,
    regimeWaterWorld: uniforms.regimeWeights.waterWorld,
    regimeArchean: uniforms.regimeWeights.archean,
    regimeUnknownGeography: uniforms.regimeWeights.unknownGeography,
  }
}

function fromIntensities(intensities: EffectIntensities, impactFlashAnchorUv: AnchorUv | null): GlobeEffectUniforms {
  return {
    regimeWeights: {
      magmaOcean: intensities.regimeMagmaOcean,
      waterWorld: intensities.regimeWaterWorld,
      archean: intensities.regimeArchean,
      unknownGeography: intensities.regimeUnknownGeography,
    },
    iceShell: intensities.iceShell,
    impactWinterVeil: intensities.impactWinterVeil,
    impactFlash: intensities.impactFlash,
    impactFlashAnchorUv,
    giantImpactFlash: intensities.giantImpactFlash,
  }
}

/** The anchor to show this render: `target` itself while non-null (a fresh flash/veil just
 *  started, or one is already showing), otherwise the last one seen for as long as
 *  `stillNeeded` (the presented flash or veil is still above 0), otherwise `null`. Pure, so the
 *  "hold" behaviour is unit-testable without React. */
export function nextHeldAnchor(current: AnchorUv | null, target: AnchorUv | null, stillNeeded: boolean): AnchorUv | null {
  if (target !== null) return target
  return stillNeeded ? current : null
}

/**
 * Rate-limits `target`'s effect intensities toward what is actually displayed (see module doc).
 * `caption` is not touched here — it is a text swap, not a value that can visibly "snap", and
 * `resolveGlobeEffects`'s own thresholds already debounce it against rapid flicker
 * (`caption.ts`'s `REGIME_CAPTION_THRESHOLD` etc.).
 */
export function usePresentedGlobeEffectUniforms(target: GlobeEffectUniforms): GlobeEffectUniforms {
  const presented = usePresentedNumericRecord(toIntensities(target), MIN_EFFECT_TRANSITION_SECONDS)

  // React's documented pattern for deriving state from a prop during render (calling `set`
  // conditionally, guarded by an equality check against the previous value) rather than an
  // effect: an effect would apply one render late, during which the shader could show the
  // still-nonzero presented flash/veil anchored at `NO_ANCHOR_UV` instead of Chicxulub.
  const [heldAnchor, setHeldAnchor] = useState<AnchorUv | null>(target.impactFlashAnchorUv)
  const stillNeeded = presented.impactFlash > 0 || presented.impactWinterVeil > 0
  const anchor = nextHeldAnchor(heldAnchor, target.impactFlashAnchorUv, stillNeeded)
  if (anchor !== heldAnchor) setHeldAnchor(anchor)

  return fromIntensities(presented, anchor)
}
