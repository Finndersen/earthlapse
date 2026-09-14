/**
 * Public API of `web/src/globe/effects` (docs/GLOBE.md G6/G8): the pre-1 Ga regime blend
 * (§4.2), the Snowball/Paleoproterozoic ice shell (§4.3), and the Chicxulub impact winter and
 * Moon-forming giant impact (§5.3) — everything ADR-013's `effect` field (G5) unlocked, now
 * wired into `Globe.tsx`. (Flood basalts — Siberian/Deccan Traps — are the one `flood-basalt`
 * kind still unwired: neither event carries an `effect` in `data/events.yaml` yet, and no
 * overlay/shader term exists for it. §9 tracks this as G6 "partial".)
 *
 * `useGlobeEffects(t, regimeEvents, effectEvents, fallbackCaption?)` is `Globe.tsx`'s
 * drop-in, called from inside it; `resolveGlobeEffects` is its pure core, safe to unit test
 * without React. `useGlobeEffects` also rate-limits `resolveGlobeEffects`'s `uniforms` through
 * `usePresentedGlobeEffectUniforms` (`presentation.ts`) before returning them, so a fast scrub
 * or playback tick fades every intensity rather than snapping it (docs/GLOBE.md §4.3) — callers
 * that need the raw, unrated target (tests, mostly) use `resolveGlobeEffects` directly.
 *
 * How `Globe.tsx` sources this package's inputs (recorded here since this package itself
 * stays framework/caller-agnostic):
 *
 * 1. `regimeEvents` is the `globe-regimes` `EventSet`'s full, unfiltered event list, not
 *    `Layer<EventsValue>.sample(t)`'s output — `regimes.ts`'s crossfade needs to see a
 *    regime's neighbour before `t` has entered it (e.g. anything from `archean-haze-regime`
 *    at all, to fade `unknown-geography` in against it, since their cited windows only touch
 *    at 2.4 Ga with zero overlap). `GlobeProps.regimeEvents` carries it straight through from
 *    `@/app/buildLayers`'s `rawEvents(eventLayers, 'globe-regimes')`, which bypasses `Layer`
 *    the same way `AppLayers.rasters` already does for `paleodem`.
 * 2. `effectEvents` is `Manifest.events` (`events-core`'s full list), already unfiltered and
 *    already loaded for the timeline — `Experience.tsx` passes the same value to both.
 * 3. `fallbackCaption` is `globeMultiCaptionFor(rasterLayers, t)` (`web/src/globe/blend.ts`),
 *    which — unlike the retired single-source `globeCaptionFor` — already carries G7's
 *    "Continents from plate model" and 540 Ma seam captions, not just the plain-PaleoDEM case.
 * 4. `uniforms` is wired into `GlobeSphere`'s `<shaderMaterial>` in `Globe.tsx` — six uniforms
 *    (`uRegimeWeights`, `uIceShell`, `uImpactWinterVeil`, `uImpactFlash`,
 *    `uImpactFlashAnchorUv`, `uGiantImpactFlash`) on `GLOBE_FRAGMENT_SHADER` in `shaders.ts`,
 *    alongside the existing `uBefore`/`uAfter`/`uMix`/`uHasData`.
 * 5. `shaders.ts`'s `uTime` (seconds, wall-clock — *not* `t`) is accumulated in
 *    `GlobeSphere`'s existing `useFrame`, next to the sphere's own auto-rotate.
 */

export { globeEffectCaption, type GlobeEffectCaptionInputs } from './caption'
export {
  anchorUv,
  type AnchorUv,
  giantImpactFlash,
  ICE_SHELL_EASE_WARP,
  iceShellIntensity,
  IMPACT_WINTER_DARK_YEARS,
  IMPACT_WINTER_RECOVERY_YEARS,
  impactWinterAnchor,
  impactWinterFlash,
  impactWinterVeil,
} from './overlays'
export { MIN_EFFECT_TRANSITION_SECONDS, nextHeldAnchor, usePresentedGlobeEffectUniforms } from './presentation'
export { dominantRegime, type RegimeKind, type RegimeWeights, regimeWeightsAt } from './regimes'
export { type GlobeEffectUniforms, resolveGlobeEffects, type ResolvedGlobeEffects } from './resolve'
export { useGlobeEffects } from './useGlobeEffects'
