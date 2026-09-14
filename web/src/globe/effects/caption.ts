/**
 * The globe's regime/effect caption (docs/GLOBE.md §7), for whichever of `regimes.ts`'s
 * blend weights and `overlays.ts`'s envelopes are active at `t`. Priority, highest first:
 * impact winter, then the ice shell, then the dominant pre-1 Ga regime. Impact winter and ice
 * shell are both §6's "closed effect kinds" — short, deliberate overlays keyed to a specific
 * citation, so neither should ever be upstaged by the calmer regime blend it's interrupting.
 * Ice shell in particular can sit *inside* a regime's own span with zero weight of its own to
 * compete on (the Paleoproterozoic glaciation, 2.426-2.46 Ga, is entirely inside
 * `archean-haze-regime`'s 2.4-4.0 Ga), so it must be checked before the dominant-regime branch,
 * not after it, or its caption is simply unreachable for that regime's entire span. Below all
 * of those, the caller's own fallback — `globeMultiCaptionFor` (`web/src/globe/blend.ts`), which
 * already carries G7's "Continents from plate model" and 540 Ma seam captions and the generic
 * `NO_RECONSTRUCTION_CAPTION` for a genuine gap.
 *
 * Every string here matches a docs/GLOBE.md §7 example verbatim ("Magma ocean", "Geography
 * unknown", "Impact winter") or its "· extent contested" convention (Snowball Earth, the
 * Paleoproterozoic glaciation) — this file is the one place that wording is assembled, so a
 * caption never drifts from its rendered effect. The shell's own bottom-of-screen note
 * ("Artistic reconstruction — plausibility, not accuracy.", `ShellLayout.tsx`) already covers
 * every still and reconstruction across the whole app, so these captions don't repeat it.
 */

import type { GeoTime, TimelineEvent } from '@/types/layer'

import { dominantRegime, type RegimeKind, type RegimeWeights } from './regimes'

const REGIME_CAPTIONS: Record<RegimeKind, string> = {
  'regime-magma-ocean': 'Magma ocean',
  'regime-water-world': 'Hadean water world',
  'regime-archean': 'Archean haze',
  'regime-unknown-geography': 'Geography unknown',
}

/** Only caption a regime once it is more than half the blend — otherwise scrubbing through a
 *  crossfade would flicker between two captions faster than either is readable. */
const REGIME_CAPTION_THRESHOLD = 0.5

/** Short display labels for the events known to carry an `ice-shell` effect, matching
 *  docs/GLOBE.md §7's "Snowball Earth · extent contested" example exactly. Falls back to the
 *  event's own `label` for any future `ice-shell` source not listed here, so a new one still
 *  gets a caption instead of none. */
const ICE_SHELL_LABELS: Readonly<Record<string, string>> = {
  'snowball-earth': 'Snowball Earth',
  'paleoproterozoic-glaciation-regime': 'Paleoproterozoic glaciation',
}

const ICE_SHELL_CAPTION_THRESHOLD = 0.5

const IMPACT_WINTER_CAPTION = 'Impact winter'

/** Low: the veil is worth captioning as soon as it's visibly darkening, not only once it's
 *  gone fully near-black — most of a scrub through the recovery tail is still "impact winter". */
const IMPACT_WINTER_CAPTION_THRESHOLD = 0.05

/** Which `ice-shell` event is "in charge" of the caption at `t` — the one whose own window
 *  envelope (not the union `iceShellIntensity`) is currently strongest, so overlapping
 *  ice-shell sources (none do today) would caption whichever is actually driving the look. */
function iceShellCaptionLabel(events: readonly TimelineEvent[], t: GeoTime): string | null {
  let best: { id: string; label: string; weight: number } | null = null
  for (const event of events) {
    const effect = event.effect
    if (effect === undefined || effect.kind !== 'ice-shell') continue
    for (const w of effect.windows) {
      const inCore = t >= w.tMin && t <= w.tMax
      const weight = inCore ? 1 : 0
      if (weight > 0 && (best === null || weight > best.weight)) {
        best = { id: event.id, label: ICE_SHELL_LABELS[event.id] ?? event.label, weight }
      }
    }
  }
  return best?.label ?? null
}

export interface GlobeEffectCaptionInputs {
  t: GeoTime
  regimeWeights: RegimeWeights
  /** Every event that might carry an `ice-shell` effect — both `events-core` (Snowball Earth)
   *  and `globe-regimes` (the Paleoproterozoic glaciation) should be included. */
  iceShellEvents: readonly TimelineEvent[]
  iceShellIntensity: number
  impactWinterVeil: number
}

/** Composes the caption for `Globe`'s caption slot (`web/src/globe/Globe.tsx`'s `caption`
 *  prop) from the resolved effect state, falling back to `fallback` (typically
 *  `globeMultiCaptionFor(rasterLayers, t)`) when nothing here is active. */
export function globeEffectCaption(inputs: GlobeEffectCaptionInputs, fallback: string): string {
  if (inputs.impactWinterVeil > IMPACT_WINTER_CAPTION_THRESHOLD) return IMPACT_WINTER_CAPTION

  if (inputs.iceShellIntensity > ICE_SHELL_CAPTION_THRESHOLD) {
    const label = iceShellCaptionLabel(inputs.iceShellEvents, inputs.t)
    if (label !== null) return `${label} · extent contested`
  }

  const dominant = dominantRegime(inputs.regimeWeights)
  if (dominant !== null && dominant.weight > REGIME_CAPTION_THRESHOLD) return REGIME_CAPTIONS[dominant.kind]

  return fallback
}
