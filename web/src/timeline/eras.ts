/**
 * Eon/era boundaries for the minimap's background bands (README §"Overview minimap"). Cited,
 * not eyeballed — the numbers below are the major-boundary ages from the International
 * Commission on Stratigraphy's International Chronostratigraphic Chart, v2024/12
 * (https://stratigraphy.org/chart), converted from Ma/Ga to years BP. This package renders
 * three eons of Precambrian time and the three Phanerozoic eras (not every stage or period —
 * "thin, muted bands for orientation", not a full stratigraphic column).
 */

import { EARTH_FORMATION, type GeoTime } from '@/types/layer'

import type { TimeWindow } from './scale'

export interface EraBand {
  id: string
  name: string
  /** [newest, oldest] years BP, same orientation as `TimeWindow`. */
  window: TimeWindow
}

const GA = 1e9
const MA = 1e6

/** Base of the Archean (top of the Hadean), ICS v2024/12: 4031 Ma. */
const ARCHEAN_BASE: GeoTime = 4.031 * GA
/** Base of the Proterozoic (top of the Archean): 2500 Ma. */
const PROTEROZOIC_BASE: GeoTime = 2.5 * GA
/** Base of the Phanerozoic / Cambrian (top of the Proterozoic): 538.8 Ma. */
const PHANEROZOIC_BASE: GeoTime = 538.8 * MA
/** Base of the Mesozoic (top of the Paleozoic), Permian-Triassic boundary: 251.902 Ma. */
const MESOZOIC_BASE: GeoTime = 251.902 * MA
/** Base of the Cenozoic (top of the Mesozoic), Cretaceous-Paleogene boundary: 66.0 Ma. */
const CENOZOIC_BASE: GeoTime = 66.0 * MA

/**
 * Oldest to newest, contiguous and covering `[0, EARTH_FORMATION]` exactly — each band's
 * `window[0]` is the previous band's `window[1]`, so there is no gap or overlap for the
 * minimap to render as a seam.
 */
export const ERA_BANDS: readonly EraBand[] = [
  { id: 'hadean', name: 'Hadean', window: [ARCHEAN_BASE, EARTH_FORMATION] },
  { id: 'archean', name: 'Archean', window: [PROTEROZOIC_BASE, ARCHEAN_BASE] },
  { id: 'proterozoic', name: 'Proterozoic', window: [PHANEROZOIC_BASE, PROTEROZOIC_BASE] },
  { id: 'paleozoic', name: 'Paleozoic', window: [MESOZOIC_BASE, PHANEROZOIC_BASE] },
  { id: 'mesozoic', name: 'Mesozoic', window: [CENOZOIC_BASE, MESOZOIC_BASE] },
  { id: 'cenozoic', name: 'Cenozoic', window: [0, CENOZOIC_BASE] },
]

/**
 * The eon/era name containing `t` (the shell's era/time title, W13) — a thin wrapper over
 * `ERA_BANDS` so callers elsewhere in the app don't need to know its window-overlap shape or
 * import the band list just to look one up. No period-level breakdown: `ERA_BANDS` only goes
 * to eon/era resolution (see this file's own doc comment), so there is none to include yet.
 * At an exact boundary shared by two adjacent bands, the older one wins, matching `ERA_BANDS`'
 * own oldest-to-newest ordering.
 */
export function eraNameForTime(t: GeoTime): string {
  const band = ERA_BANDS.find((b) => t >= b.window[0] && t <= b.window[1])
  if (band === undefined) {
    throw new Error(`eraNameForTime: t=${t} is outside ERA_BANDS' domain [0, ${EARTH_FORMATION}]`)
  }
  return band.name
}
