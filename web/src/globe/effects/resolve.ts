/**
 * Top-level entry point for G6/G8's globe effects: given `t` and the two event sources that
 * carry `effect` data, returns everything `Globe.tsx` needs to render them plus the caption
 * to show. Pure in `t` (DESIGN §10's `Layer.sample()` rule, extended to every globe effect by
 * docs/GLOBE.md §6) — no fetching, no refs, no component state; `useGlobeEffects` below is
 * the only place a hook touches this.
 */

import type { GeoTime, TimelineEvent } from '@/types/layer'

import { globeEffectCaption } from './caption'
import { anchorUv, type AnchorUv, giantImpactFlash, iceShellIntensity, impactWinterAnchor, impactWinterFlash, impactWinterVeil } from './overlays'
import { regimeWeightsAt, type RegimeWeights } from './regimes'

export type { AnchorUv } from './overlays'
export { dominantRegime, type RegimeKind, type RegimeWeights, regimeWeightsAt } from './regimes'

/** Everything the shader needs, in the shape its uniforms want (`shaders.ts`'s new
 *  `uRegimeWeights`/`uIceShell`/`uImpactWinterVeil`/`uImpactFlash`/`uImpactFlashAnchorUv`/
 *  `uGiantImpactFlash`). Every field is 0 (or `null`) when nothing is active, which is exactly
 *  `GlobeSphere`'s current default — see this package's `index.ts` for the integration note. */
export interface GlobeEffectUniforms {
  regimeWeights: RegimeWeights
  iceShell: number
  impactWinterVeil: number
  impactFlash: number
  impactFlashAnchorUv: AnchorUv | null
  giantImpactFlash: number
}

export interface ResolvedGlobeEffects {
  uniforms: GlobeEffectUniforms
  caption: string
}

/**
 * Resolves every G6/G8 globe effect at `t`.
 *
 * - `regimeEvents` — the `globe-regimes` `EventSet`'s full, unfiltered event list (not
 *   `Layer<EventsValue>.sample(t)`'s output — see `regimes.ts`'s doc comment for why).
 * - `effectEvents` — `events-core`'s events (e.g. `Manifest.events`, already the full list
 *   the timeline itself renders from): read for `moon-forming-impact` (`giant-impact`),
 *   `snowball-earth` (`ice-shell`) and `k-pg-impact` (`impact-winter`).
 * - `fallbackCaption` — shown when no regime or overlay effect is active; pass
 *   `globeMultiCaptionFor(rasterLayers, t)` (`web/src/globe/blend.ts`) for the raster domain's
 *   own caption (real data, the 540 Ma seam, or "continents from plate model").
 */
export function resolveGlobeEffects(
  t: GeoTime,
  regimeEvents: readonly TimelineEvent[],
  effectEvents: readonly TimelineEvent[],
  fallbackCaption = '',
): ResolvedGlobeEffects {
  const regimeWeights = regimeWeightsAt(regimeEvents, t)
  // Ice-shell has two independent sources: the Paleoproterozoic glaciation regime
  // (`globe-regimes`) and Snowball Earth's Sturtian/Marinoan windows (`events-core`) —
  // docs/GLOBE.md §4.3 renders both with the same effect.
  const iceShellEvents = [...regimeEvents, ...effectEvents]
  const iceShell = iceShellIntensity(iceShellEvents, t)
  const veil = impactWinterVeil(effectEvents, t)
  const flash = impactWinterFlash(effectEvents, t)
  // The anchor is a static fact about the event (its present-day lat/lon), not itself a
  // function of t — but exposing it only while the effect it marks is actually visible keeps
  // "no effect uniforms active" (the common case, everywhere outside a handful of windows)
  // genuinely inert, with nothing for the integrator to accidentally render unconditionally.
  const anchor = veil > 0 || flash > 0 ? impactWinterAnchor(effectEvents) : null

  const uniforms: GlobeEffectUniforms = {
    regimeWeights,
    iceShell,
    impactWinterVeil: veil,
    impactFlash: flash,
    impactFlashAnchorUv: anchor !== null ? anchorUv(anchor) : null,
    giantImpactFlash: giantImpactFlash(effectEvents, t),
  }

  const caption = globeEffectCaption(
    { t, regimeWeights, iceShellEvents, iceShellIntensity: iceShell, impactWinterVeil: veil },
    fallbackCaption,
  )

  return { uniforms, caption }
}
