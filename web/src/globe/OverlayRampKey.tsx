'use client'

/**
 * The colour key for whichever overlay `OverlaySelect` has chosen — a generalisation of
 * `DensityRampKey.tsx` (population density's original, single-overlay key) to any
 * `GlobeOverlayKind`. Same principles as that original:
 *
 * Gradient and tick positions are generated from the overlay's own ramp stops — the same stops
 * the fragment shader interpolates — so the key can never claim a colour the globe does not
 * paint. Each gradient stop carries the stop's own alpha, so the bar shows the overlay's real
 * transparency at the low end rather than implying a solid tint.
 *
 * The two ramps place a stop differently: density is positioned at `log10(1 + density)` (an
 * order-of-magnitude spread), cleared land linearly in severity (a plain 0..1 fraction). That
 * difference is kept explicit as a per-kind descriptor below, rather than smoothed into one
 * generic "position" function, so a third overlay with a third spacing rule is a type error here
 * instead of a silent misread of its ramp.
 */

import { CLEARED_LAND_RAMP, type ClearedLandRampStop } from './clearedLand'
import { DENSITY_RAMP, type DensityRampStop } from './density'
import type { GlobeOverlayKind } from './overlay'
import styles from './OverlayRampKey.module.css'

interface RampTick {
  readonly value: number
  readonly label: string
}

/** A ramp stop reduced to what this component draws with — position already resolved to 0..1, so
 *  the two ramps' differing "stop scalar → bar position" rules (log-spaced density, linear
 *  severity) are applied once, up front, rather than threaded through every consumer below. */
interface RampPoint {
  readonly position: number
  readonly hex: string
  readonly alpha: number
}

/** A ramp's points, positioning function, and labelled ticks — everything `OverlayRampKey` needs
 *  to draw one kind's key. `positionOf` stays on the descriptor (not only baked into `points`) so
 *  ticks — given in the ramp's own real units, not positions — can be placed with it too. */
interface RampDescriptor {
  readonly points: readonly RampPoint[]
  readonly positionOf: (value: number) => number
  readonly ticks: readonly RampTick[]
  readonly unit: string
}

function densityPosition(density: number): number {
  return Math.log10(1 + density)
}

const densityRampStart = densityPosition(DENSITY_RAMP[0]!.density)
const densityRampEnd = densityPosition(DENSITY_RAMP[DENSITY_RAMP.length - 1]!.density)

function densityUnitPosition(density: number): number {
  return (densityPosition(density) - densityRampStart) / (densityRampEnd - densityRampStart)
}

const clearedLandRampStart = CLEARED_LAND_RAMP[0]!.severity
const clearedLandRampEnd = CLEARED_LAND_RAMP[CLEARED_LAND_RAMP.length - 1]!.severity

function clearedLandUnitPosition(severity: number): number {
  return (severity - clearedLandRampStart) / (clearedLandRampEnd - clearedLandRampStart)
}

function points<Stop extends { readonly hex: string; readonly alpha: number }>(
  stops: readonly Stop[],
  valueOf: (stop: Stop) => number,
  positionOf: (value: number) => number,
): readonly RampPoint[] {
  return stops.map((stop) => ({ position: positionOf(valueOf(stop)), hex: stop.hex, alpha: stop.alpha }))
}

const RAMPS: Readonly<Record<GlobeOverlayKind, RampDescriptor>> = {
  population_density: {
    points: points(DENSITY_RAMP, (stop: DensityRampStop) => stop.density, densityUnitPosition),
    positionOf: densityUnitPosition,
    ticks: [
      { value: 1, label: '1' },
      { value: 10, label: '10' },
      { value: 100, label: '100' },
      { value: 1000, label: '1k' },
      { value: 10000, label: '10k' },
    ],
    unit: 'people / km²',
  },
  cleared_land: {
    points: points(CLEARED_LAND_RAMP, (stop: ClearedLandRampStop) => stop.severity, clearedLandUnitPosition),
    positionOf: clearedLandUnitPosition,
    ticks: [
      { value: 0.25, label: '25%' },
      { value: 0.5, label: '50%' },
      { value: 0.75, label: '75%' },
      { value: 1, label: '100%' },
    ],
    // Severity is a weighted share (cropland + 0.6 × pasture/converted rangeland), not a raw
    // fraction of cleared area — "share of land worked" avoids the numeric overclaim "% cleared"
    // would make.
    unit: 'share of land worked',
  },
}

/** `#rrggbb` + alpha as a plain `rgba()` — written out rather than using CSS relative-colour
 *  syntax, which is too new to rely on across the browsers this page targets. */
function rgba(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16)
  return `rgba(${(value >> 16) & 0xff}, ${(value >> 8) & 0xff}, ${value & 0xff}, ${alpha})`
}

function gradientFor(descriptor: RampDescriptor): string {
  const stopsCss = descriptor.points
    .map((point) => `${rgba(point.hex, point.alpha)} ${(point.position * 100).toFixed(1)}%`)
    .join(', ')
  return `linear-gradient(to right, ${stopsCss})`
}

export function OverlayRampKey({ kind }: { kind: GlobeOverlayKind }) {
  const descriptor = RAMPS[kind]
  const gradient = gradientFor(descriptor)
  return (
    <div className={styles.rampKey} data-testid="overlay-ramp-key">
      <div className={styles.rampBar} style={{ background: gradient }} aria-hidden="true" />
      <div className={styles.rampTicks} aria-hidden="true">
        {descriptor.ticks.map((tick) => (
          <span key={tick.value} className={styles.rampTick} style={{ left: `${descriptor.positionOf(tick.value) * 100}%` }}>
            {tick.label}
          </span>
        ))}
      </div>
      <span className={styles.rampUnit}>{descriptor.unit}</span>
    </div>
  )
}
