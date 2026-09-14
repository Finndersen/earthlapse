/**
 * Tier-1 ambience stem gains (ADR-023 §1, DESIGN §11). `stemGains(t, flatBasaltWindows)` is
 * pure in both arguments and called every engine tick while sound is on — see `engine.ts` —
 * so it stays allocation-light and never imports `tone`.
 *
 * Every curve below is copied from ADR-023 §1's table and cross-checked against
 * `data/events.yaml`'s real `t_min`/`t`/`t_max` for the cited event ids (`land-plants`,
 * `first-forests`, `k-pg-impact`, `control-of-fire`, `agriculture`, `industrial-revolution`) —
 * see that ADR for citations. `flatBasaltWindows` is deliberately generic: it is every window
 * of every `Manifest.events` entry whose `effect.kind === 'flood-basalt'` (derived once by the
 * caller, e.g. `engine.ts`, from the loaded manifest — never refetched or filtered here), so a
 * newly-published flood-basalt event drives a `volcanic` bump automatically, with no new code
 * in this file.
 */

import type { GeoTime } from '@/types/layer'

import { bump, clampUnit, rampLog, type TimeWindow } from './ramp'
import { STEM_IDS, type StemGains } from './stemIds'

/** Weight of each flood-basalt window's bump in the `volcanic` stem (ADR-023 §1: "a
 *  `rampInLog`/`rampOutLog` pulse to 0.6"). */
const VOLCANIC_FLOOD_BASALT_BUMP_GAIN = 0.6

function settlementPresentTail(t: GeoTime): number {
  if (t >= 1.15e4) return 0
  return 0.28 * (1 - Math.log1p(t) / Math.log1p(11500))
}

function machineryGain(t: GeoTime): number {
  if (t >= 250) return 0
  return 1 - Math.log1p(t) / Math.log1p(250)
}

/**
 * Every stem's gain at `t`, each independently clamped to `[0, 1]` (ADR-023 §1: "never let two
 * contributions push a stem over 1").
 */
export function stemGains(t: GeoTime, flatBasaltWindows: ReadonlyArray<TimeWindow>): StemGains {
  const volcanicFloodBasaltBump = flatBasaltWindows.reduce(
    (sum, window) => sum + VOLCANIC_FLOOD_BASALT_BUMP_GAIN * bump(t, window),
    0,
  )

  const raw: StemGains = {
    wind: rampLog(t, 4.7e8, 3.78e8, 0.6, 0.32),
    water: 0.45 + rampLog(t, 4.0e9, 3.8e9, 0.15, 0),
    storm: 0.22,
    volcanic: rampLog(t, 4.0e9, 5.4e8, 0.75, 0.15) + volcanicFloodBasaltBump,
    insects: rampLog(t, 4.0e8, 3.7e8, 0, 0.35),
    birds: rampLog(t, 1.45e8, 1.0e8, 0, 0.28) + rampLog(t, 6.606e7, 6.5e7, 0, 0.12),
    mammals: rampLog(t, 6.606e7, 6.0e7, 0.04, 0.32),
    fire: rampLog(t, 4.2e8, 4.0e8, 0, 0.15) + rampLog(t, 1.5e6, 2.81e5, 0, 0.17),
    settlement: rampLog(t, 1.15e4, 1.0e4, 0, 0.22) + settlementPresentTail(t),
    machinery: machineryGain(t),
  }

  const clamped = {} as StemGains
  for (const id of STEM_IDS) {
    clamped[id] = clampUnit(raw[id])
  }
  return clamped
}
