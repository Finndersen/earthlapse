/**
 * The globe's rough Cenozoic ice age, as a pure function of `t`: how much ice there is (the
 * LR04-derived `ice_volume` and `sea_level` layers, sources/lr04) and which ice sheets may exist
 * at all yet (Antarctica from the Eocene-Oligocene transition, the Northern Hemisphere sheets from
 * their intensification at ~2.7 Ma). `iceSheets.ts` turns this into geometry and `shelf.ts` into
 * exposed shelf.
 */

import type { GeoTime, Layer, ScalarValue } from '@/types/layer'

import { warpedEdgeProgress } from '../effects/math'

export const ICE_VOLUME_LAYER_ID = 'ice_volume'
export const SEA_LEVEL_LAYER_ID = 'sea_level'

export interface IceAgeLayers {
  /** LGM = 1, present = 0. */
  iceVolume: Layer<ScalarValue>
  /** Global mean sea level relative to present, metres. */
  seaLevel: Layer<ScalarValue>
}

/** Both LR04 layers, or `null` when either is not published. */
export function iceAgeLayersFrom(scalarLayers: ReadonlyMap<string, Layer<ScalarValue>>): IceAgeLayers | null {
  const iceVolume = scalarLayers.get(ICE_VOLUME_LAYER_ID)
  const seaLevel = scalarLayers.get(SEA_LEVEL_LAYER_ID)
  return iceVolume === undefined || seaLevel === undefined ? null : { iceVolume, seaLevel }
}

/** Oi-1, the first large, permanent Antarctic ice sheet at the Eocene-Oligocene transition
 *  (Coxall et al. 2005, Nature 433:53-57; ~33.7 Ma). */
export const ANTARCTIC_ONSET_T = 33.7e6
/** The intensification of Northern Hemisphere glaciation (Haug et al. 2005, Nature 433:821-825;
 *  ~2.7 Ma). */
export const NORTHERN_ONSET_T = 2.7e6

/** Onset ease widths in the timeline's symlog warp (`effects/math.ts`): Antarctica's ~0.7 Myr and
 *  the Northern sheets' ~0.3 Myr, the order of each transition's own length, and wide enough to
 *  read as a fade on screen rather than a cut. */
export const ANTARCTIC_ONSET_EASE_WARP = 0.02
export const NORTHERN_ONSET_EASE_WARP = 0.1

export interface IceAgeState {
  /** LGM = 1, present = 0; 0 where LR04 has no coverage. */
  iceVolume: number
  /** Metres relative to present; 0 where LR04 has no coverage. */
  seaLevelM: number
  northernGate: number
  antarcticGate: number
}

export const NO_ICE_AGE: IceAgeState = { iceVolume: 0, seaLevelM: 0, northernGate: 0, antarcticGate: 0 }

/** 1 at and after `onset`, easing to 0 over `easeWarp` of warped time before it. */
export function onsetGate(t: GeoTime, onset: GeoTime, easeWarp: number): number {
  return t <= onset ? 1 : 1 - warpedEdgeProgress(t, onset, easeWarp)
}

/** The layer's value at `t`, held at its newest sample across the few decades between it and the
 *  present (LR04's youngest row is AD 1950), and 0 where it has no coverage at all. */
function sampleHeldToPresent(layer: Layer<ScalarValue>, t: GeoTime): number {
  const [newest] = layer.timeDomain
  return layer.sample(Math.max(t, newest))?.value ?? 0
}

export function iceAgeStateAt(t: GeoTime, layers: IceAgeLayers | null): IceAgeState {
  const antarcticGate = onsetGate(t, ANTARCTIC_ONSET_T, ANTARCTIC_ONSET_EASE_WARP)
  if (antarcticGate === 0) return NO_ICE_AGE
  return {
    iceVolume: layers === null ? 0 : sampleHeldToPresent(layers.iceVolume, t),
    seaLevelM: layers === null ? 0 : sampleHeldToPresent(layers.seaLevel, t),
    northernGate: onsetGate(t, NORTHERN_ONSET_T, NORTHERN_ONSET_EASE_WARP),
    antarcticGate,
  }
}

/** Ice volume (LGM = 1) from which the Northern sheets read as a glacial rather than today's
 *  Greenland, and the caption says the sheets are schematic. */
export const GLACIAL_CAPTION_ICE_VOLUME = 0.3

export const GLACIAL_ICE_CAPTION = 'Ice-age ice sheets · extent schematic'

/** The caption for `state`, or `''`. The permanent Antarctic cap alone is not captioned: it stands
 *  where today's ice does, like the basemap's own. */
export function iceAgeCaption(state: IceAgeState): string {
  return state.northernGate >= 0.5 && state.iceVolume >= GLACIAL_CAPTION_ICE_VOLUME ? GLACIAL_ICE_CAPTION : ''
}
