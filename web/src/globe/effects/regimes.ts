/**
 * Pre-1 Ga regime blending (docs/GLOBE.md §4.2, G8). Turns the `globe-regimes` `EventSet`
 * (`data/globe_regimes.yaml`) into per-regime blend weights that sum to at most 1 at any `t`,
 * with long, soft crossfades at every boundary — including the three boundaries where the
 * cited dates simply touch (zero overlap): docs/GLOBE.md §4.2 is explicit that "the
 * boundaries between regimes are deliberately soft: long crossfades, never a hard switch",
 * so this manufactures softness there rather than reproducing the citations' hard edges.
 *
 * Takes the regime `EventSet`'s full, unfiltered event list — not `Layer<EventsValue>.sample(t)`
 * — because a crossfade needs to see a regime's neighbour *before* `t` enters it, the same
 * reason `buildLayers.ts` already hands the globe raw `RasterData` instead of a `Layer`
 * (`RasterLayerEntry`'s own doc comment). See this package's `index.ts` for how the
 * integrator should source that full list.
 */

import type { GeoTime, GlobeEffectKind, TimelineEvent } from '@/types/layer'

import { smoothstep, symlogWarp } from './math'

export type RegimeKind = Extract<
  GlobeEffectKind,
  'regime-magma-ocean' | 'regime-water-world' | 'regime-archean' | 'regime-unknown-geography'
>

const REGIME_KINDS: ReadonlySet<GlobeEffectKind> = new Set<RegimeKind>([
  'regime-magma-ocean',
  'regime-water-world',
  'regime-archean',
  'regime-unknown-geography',
])

function isRegimeKind(kind: GlobeEffectKind): kind is RegimeKind {
  return REGIME_KINDS.has(kind)
}

/** Floor on how soft a boundary is, even where two regimes' cited windows only touch (zero
 *  overlap) rather than genuinely overlap. Sized in warp space (`math.ts`'s `symlogWarp`), not
 *  a fixed number of years, for the same reason `overlays.ts`'s ice-shell ease is: these
 *  regimes sit billions of years deep, where a fixed-year width goes sub-pixel and a boundary
 *  that should read as a long crossfade instead reads as a cut. `MIN_CROSSFADE_HALF_WIDTH_WARP`
 *  is imperceptible against every regime's own span (the shortest, `archean-haze-regime`, is
 *  1.6 Gyr) but enough that scrubbing across a boundary reads as a fade, not a cut. Where two
 *  regimes' cited dates already overlap by more than this (magma-ocean/water-world's cited
 *  50 Myr), the real overlap — itself measured in warp space below — is used instead. */
const MIN_CROSSFADE_HALF_WIDTH_WARP = 2.5e-3

/** Ease width for a regime's own open edge — one with no neighbouring regime to crossfade
 *  against (magma-ocean's older edge: nothing precedes it; unknown-geography's younger edge:
 *  it hands off to the Merdith continents of §4.1/G7, not modelled here). Same order of
 *  magnitude as `MIN_CROSSFADE_HALF_WIDTH_WARP`, in the same warp-space units, so the two kinds
 *  of edge read consistently. */
const STANDALONE_EDGE_EASE_WARP = 5e-3

interface RegimeSpan {
  kind: RegimeKind
  /** Years BP, nearer the present. */
  tMin: GeoTime
  /** Years BP, further into the past. */
  tMax: GeoTime
}

/** Every `regime-*` effect window in the set, oldest (`tMax` descending) first — the order
 *  the crossfade math below walks neighbours in. A regime with more than one window (none do,
 *  today) would contribute one span per window. */
function regimeSpans(regimeEvents: readonly TimelineEvent[]): RegimeSpan[] {
  const spans: RegimeSpan[] = []
  for (const event of regimeEvents) {
    const effect = event.effect
    if (effect === undefined || !isRegimeKind(effect.kind)) continue
    for (const w of effect.windows) {
      spans.push({ kind: effect.kind, tMin: w.tMin, tMax: w.tMax })
    }
  }
  return spans.sort((a, b) => b.tMax - a.tMax)
}

/** How much of `span`'s weight survives at its older edge (`tMax`), given its older neighbour
 *  `older` (or `undefined` for the oldest span, which has none). 1 deep inside `span`, 0 once
 *  `older` has fully taken over (or, standalone, once `t` has aged past `span.tMax`).
 *
 *  Every boundary here is computed in warp space (`symlogWarp`, `t`'s monotonic symlog warp),
 *  not raw years — see `MIN_CROSSFADE_HALF_WIDTH_WARP`'s doc comment for why: a fixed-year
 *  crossfade goes sub-pixel this deep in time. `symlogWarp` is monotonic increasing in `t`, so
 *  substituting warped values throughout preserves the same "0 well inside, 1 once the
 *  neighbour dominates" direction the original years-based `smoothstep` had. */
function olderEdgeWeight(span: RegimeSpan, older: RegimeSpan | undefined, t: GeoTime): number {
  const wT = symlogWarp(t)
  if (older === undefined) {
    const wSpanMax = symlogWarp(span.tMax)
    return 1 - smoothstep(wSpanMax - STANDALONE_EDGE_EASE_WARP, wSpanMax, wT)
  }
  const wSpanMax = symlogWarp(span.tMax)
  const wOlderMin = symlogWarp(older.tMin)
  const center = (wSpanMax + wOlderMin) / 2
  const halfWidth = Math.max(MIN_CROSSFADE_HALF_WIDTH_WARP, Math.abs(wOlderMin - wSpanMax) / 2)
  // 0 well inside `span` (t small, i.e. younger than the boundary), 1 once `older` dominates.
  return 1 - smoothstep(center - halfWidth, center + halfWidth, wT)
}

/** Mirror of `olderEdgeWeight` for `span`'s younger edge (`tMin`) against its younger
 *  neighbour. 1 deep inside `span`, 0 once the younger neighbour (or, standalone, "no
 *  regime") has taken over. Warp-space throughout, for the same reason. */
function youngerEdgeWeight(span: RegimeSpan, younger: RegimeSpan | undefined, t: GeoTime): number {
  const wT = symlogWarp(t)
  if (younger === undefined) {
    const wSpanMin = symlogWarp(span.tMin)
    return smoothstep(wSpanMin, wSpanMin + STANDALONE_EDGE_EASE_WARP, wT)
  }
  const wSpanMin = symlogWarp(span.tMin)
  const wYoungerMax = symlogWarp(younger.tMax)
  const center = (wSpanMin + wYoungerMax) / 2
  const halfWidth = Math.max(MIN_CROSSFADE_HALF_WIDTH_WARP, Math.abs(wSpanMin - wYoungerMax) / 2)
  return smoothstep(center - halfWidth, center + halfWidth, wT)
}

/** Blend weight for every `regime-*` kind at `t`, in a fixed shape so it maps directly onto a
 *  4-component shader uniform. Each is 0..1; their sum is 0 where no regime applies (inside
 *  the PaleoDEM/plate-model domain, or in the open years before any regime or after
 *  unknown-geography) and rises to 1 in every regime's interior, dipping only across a
 *  crossfade. */
export interface RegimeWeights {
  magmaOcean: number
  waterWorld: number
  archean: number
  unknownGeography: number
}

const ZERO_REGIME_WEIGHTS: RegimeWeights = { magmaOcean: 0, waterWorld: 0, archean: 0, unknownGeography: 0 }

const REGIME_WEIGHT_KEY: Record<RegimeKind, keyof RegimeWeights> = {
  'regime-magma-ocean': 'magmaOcean',
  'regime-water-world': 'waterWorld',
  'regime-archean': 'archean',
  'regime-unknown-geography': 'unknownGeography',
}

export function regimeWeightsAt(regimeEvents: readonly TimelineEvent[], t: GeoTime): RegimeWeights {
  const spans = regimeSpans(regimeEvents)
  if (spans.length === 0) return ZERO_REGIME_WEIGHTS

  const weights: RegimeWeights = { ...ZERO_REGIME_WEIGHTS }
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i]!
    const weight = Math.min(olderEdgeWeight(span, spans[i - 1], t), youngerEdgeWeight(span, spans[i + 1], t))
    const key = REGIME_WEIGHT_KEY[span.kind]
    weights[key] = Math.max(weights[key], weight)
  }
  return weights
}

/** The dominant regime at `t`, i.e. the one carrying the most weight, and that weight —
 *  `null` when nothing is active. Used to decide when a regime is confidently in charge
 *  enough to caption (`caption.ts`), not to render (rendering blends all four). */
export function dominantRegime(weights: RegimeWeights): { kind: RegimeKind; weight: number } | null {
  let best: { kind: RegimeKind; weight: number } | null = null
  for (const kind of REGIME_KINDS as ReadonlySet<RegimeKind>) {
    const weight = weights[REGIME_WEIGHT_KEY[kind]]
    if (best === null || weight > best.weight) best = { kind, weight }
  }
  return best !== null && best.weight > 0 ? best : null
}
