import { ERA_BANDS } from '@/timeline'
import type { GeoTime } from '@/types/layer'

/**
 * The name of the eon/era band (`ERA_BANDS`) containing `t`. A boundary age belongs to the
 * younger band — ICS boundaries are the *base* of the younger unit — so the bands are searched
 * newest first.
 */
export function eraNameAt(t: GeoTime): string {
  const band = [...ERA_BANDS].reverse().find((b) => t >= b.window[0] && t <= b.window[1])
  if (band === undefined) throw new RangeError(`eraNameAt: t=${t} is outside every era band`)
  return band.name
}
