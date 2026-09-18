import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION } from '@/types/layer'
import type { ArrivalGlobeEffect, GeoTime, GlobeEffectAnchor, TimelineEvent } from '@/types/layer'

import {
  type ArrivalTiming,
  arrivalPresentationAt,
  arrivalTimingFor,
  arrivalWindow,
  buildArrivalArcGeometry,
  buildArrivalIndex,
  buildFatLineBuffers,
  type DistancedAnchor,
  greatCircleLonLatPoints,
  hasVisibleArrivals,
  isDegenerateArrival,
  sphereMarkerVisibility,
  traceToOrigin,
} from './arcs'
import { SYMLOG_C, symlogWarp } from './effects/math'

/** `buildFatLineBuffers` takes `DistancedAnchor`s (docs/GLOBE.md §10); every test here
 *  builds its own points via `greatCircleLonLatPoints` alone (plain `GlobeEffectAnchor`s, no
 *  split), so an evenly-spaced `i / (n - 1)` distance — exactly what `buildArrivalArcGeometry`
 *  itself computes before ever splitting — is the right one to attach. */
function withDistance(points: readonly GlobeEffectAnchor[]): DistancedAnchor[] {
  const denom = Math.max(points.length - 1, 1)
  return points.map((p, i) => ({ ...p, distance: i / denom }))
}

const OUT_OF_AFRICA: ArrivalGlobeEffect = {
  kind: 'arrival',
  arrivalKind: 'migration',
  origin: { lat: 9.0, lon: 42.0 },
  destination: { lat: 20.0, lon: 48.0 },
  established: 6.0e4,
  windows: [{ tMin: 0, tMax: 7.0e4 }],
}

// A schematic Beringia -> Americas arrival, chosen because a great circle between them crosses
// the antimeridian.
const BERINGIA_TO_AMERICAS: ArrivalGlobeEffect = {
  kind: 'arrival',
  arrivalKind: 'peopling',
  origin: { lat: 65.0, lon: 170.0 },
  destination: { lat: 55.0, lon: -130.0 },
  established: 1.5e4,
  windows: [{ tMin: 0, tMax: 2.0e4 }],
}

const DEGENERATE: ArrivalGlobeEffect = {
  kind: 'arrival',
  arrivalKind: 'peopling',
  origin: { lat: 9.0, lon: 34.0 },
  destination: { lat: 9.0, lon: 34.0 },
  established: 3.15e5,
  windows: [{ tMin: 0, tMax: 3.15e5 }],
}

describe('greatCircleLonLatPoints', () => {
  it('starts and ends exactly at origin and destination', () => {
    const points = greatCircleLonLatPoints(OUT_OF_AFRICA.origin, OUT_OF_AFRICA.destination, 8)
    expect(points[0]).toEqual(OUT_OF_AFRICA.origin)
    expect(points.at(-1)).toEqual(OUT_OF_AFRICA.destination)
    expect(points).toHaveLength(9)
  })

  it('returns a single point for a degenerate (zero-length) arrival', () => {
    const points = greatCircleLonLatPoints(DEGENERATE.origin, DEGENERATE.destination, 8)
    expect(points).toEqual([DEGENERATE.origin])
  })

  it('every interior point lies on the unit sphere between the endpoints (sanity: finite, in range)', () => {
    const points = greatCircleLonLatPoints(OUT_OF_AFRICA.origin, OUT_OF_AFRICA.destination, 16)
    for (const p of points) {
      expect(Number.isFinite(p.lat)).toBe(true)
      expect(Number.isFinite(p.lon)).toBe(true)
      expect(p.lat).toBeGreaterThanOrEqual(-90)
      expect(p.lat).toBeLessThanOrEqual(90)
      expect(p.lon).toBeGreaterThanOrEqual(-180)
      expect(p.lon).toBeLessThanOrEqual(180)
    }
  })
})

describe('isDegenerateArrival', () => {
  it('is true only when origin and destination are identical', () => {
    expect(isDegenerateArrival(DEGENERATE)).toBe(true)
    expect(isDegenerateArrival(OUT_OF_AFRICA)).toBe(false)
  })
})

describe('buildArrivalArcGeometry', () => {
  it('splits at the antimeridian for an arc that crosses it', () => {
    const geometry = buildArrivalArcGeometry('beringia-arrival', BERINGIA_TO_AMERICAS)
    expect(geometry.isDegenerate).toBe(false)
    expect(geometry.segments.length).toBeGreaterThanOrEqual(2)
    // No segment should itself contain a >180 degree jump between consecutive points — that's
    // exactly the streak-across-the-map bug splitting is meant to prevent.
    for (const segment of geometry.segments) {
      for (let i = 1; i < segment.length; i++) {
        expect(Math.abs(segment[i]!.lon - segment[i - 1]!.lon)).toBeLessThanOrEqual(180)
      }
    }
  })

  it('does not split an arc that never crosses the antimeridian', () => {
    const geometry = buildArrivalArcGeometry('out-of-africa-migration', OUT_OF_AFRICA)
    expect(geometry.segments).toHaveLength(1)
  })

  it('is a degenerate point with no segments for origin === destination', () => {
    const geometry = buildArrivalArcGeometry('homo-sapiens-origin', DEGENERATE)
    expect(geometry.isDegenerate).toBe(true)
    expect(geometry.segments).toEqual([])
  })

  it('carries cumulative distance across a split continuously, 0 at the origin to 1 at the destination (docs/GLOBE.md §10)', () => {
    const geometry = buildArrivalArcGeometry('beringia-arrival', BERINGIA_TO_AMERICAS)
    expect(geometry.segments.length).toBeGreaterThanOrEqual(2)
    expect(geometry.segments[0]![0]!.distance).toBe(0)
    expect(geometry.segments.at(-1)!.at(-1)!.distance).toBe(1)
    // Strictly increasing within a piece and across the seam it shares with the next piece — no
    // reset to 0 partway through, which is exactly the bug a piece-local i/(n-1) fraction had.
    const flattened = geometry.segments.flat()
    for (let i = 1; i < flattened.length; i++) {
      expect(flattened[i]!.distance).toBeGreaterThanOrEqual(flattened[i - 1]!.distance)
    }
  })

  it('does not split a non-crossing arc, so its distance is a plain 0..1 sweep with no seam points', () => {
    const geometry = buildArrivalArcGeometry('out-of-africa-migration', OUT_OF_AFRICA)
    const [segment] = geometry.segments
    expect(segment![0]!.distance).toBe(0)
    expect(segment!.at(-1)!.distance).toBe(1)
  })
})

describe('buildFatLineBuffers', () => {
  it('emits two vertices per point, sides -1 and +1, sharing distance/dir', () => {
    const points = withDistance(greatCircleLonLatPoints(OUT_OF_AFRICA.origin, OUT_OF_AFRICA.destination, 4))
    const buffers = buildFatLineBuffers(points)
    expect(buffers.side).toHaveLength(points.length * 2)
    expect(buffers.distance).toHaveLength(points.length * 2)
    for (let i = 0; i < points.length; i++) {
      expect(buffers.side[i * 2]).toBe(-1)
      expect(buffers.side[i * 2 + 1]).toBe(1)
      expect(buffers.distance[i * 2]).toBe(buffers.distance[i * 2 + 1])
      expect(buffers.lonLat[i * 4]).toBeCloseTo(points[i]!.lon)
      expect(buffers.lonLat[i * 4 + 1]).toBeCloseTo(points[i]!.lat)
    }
  })

  it('gives both side copies of one point index the same dirA/dirB (no seam at shared joints)', () => {
    const points = withDistance(greatCircleLonLatPoints(OUT_OF_AFRICA.origin, OUT_OF_AFRICA.destination, 6))
    const buffers = buildFatLineBuffers(points)
    for (let i = 0; i < points.length; i++) {
      const left = i * 2
      const right = i * 2 + 1
      expect(buffers.dirA[left * 2]).toBe(buffers.dirA[right * 2])
      expect(buffers.dirA[left * 2 + 1]).toBe(buffers.dirA[right * 2 + 1])
      expect(buffers.dirB[left * 2]).toBe(buffers.dirB[right * 2])
      expect(buffers.dirB[left * 2 + 1]).toBe(buffers.dirB[right * 2 + 1])
    }
  })

  it('produces two triangles (6 indices) per segment between consecutive points', () => {
    const points = withDistance(greatCircleLonLatPoints(OUT_OF_AFRICA.origin, OUT_OF_AFRICA.destination, 5))
    const buffers = buildFatLineBuffers(points)
    expect(buffers.indices).toHaveLength((points.length - 1) * 6)
    // Every index must reference a real vertex.
    for (const idx of buffers.indices) {
      expect(idx).toBeLessThan(points.length * 2)
      expect(idx).toBeGreaterThanOrEqual(0)
    }
  })

  it('clamps end-point tangent neighbours to the arc’s own ends rather than going out of range', () => {
    const points = withDistance(greatCircleLonLatPoints(OUT_OF_AFRICA.origin, OUT_OF_AFRICA.destination, 3))
    const buffers = buildFatLineBuffers(points)
    // First point's dirA is itself (clamped at 0).
    expect(buffers.dirA[0]).toBeCloseTo(points[0]!.lon)
    // Last point's dirB is itself (clamped at n-1).
    const lastLeft = (points.length - 1) * 2
    expect(buffers.dirB[lastLeft * 2]).toBeCloseTo(points.at(-1)!.lon)
  })

  it('reads distance straight from each point, not a local i/(n-1) fraction of just this array (docs/GLOBE.md §10)', () => {
    // A stand-in for one antimeridian-split piece: cumulative progress over a sub-range of the
    // whole arc (0.4..0.7), not 0..1 — buildFatLineBuffers must pass it through unchanged so a
    // split piece's dash pattern continues from where the piece before it left off.
    const points: DistancedAnchor[] = [
      { lat: 0, lon: -20, distance: 0.4 },
      { lat: 5, lon: -10, distance: 0.55 },
      { lat: 10, lon: 0, distance: 0.7 },
    ]
    const buffers = buildFatLineBuffers(points)
    // Float32Array storage: compare element-by-element with toBeCloseTo, not a deep toEqual
    // against exact float64 literals.
    const expected = [0.4, 0.4, 0.55, 0.55, 0.7, 0.7]
    expect(buffers.distance).toHaveLength(expected.length)
    expected.forEach((value, i) => expect(buffers.distance[i]).toBeCloseTo(value, 5))
  })
})

describe('sphereMarkerVisibility', () => {
  const CAMERA_DISTANCE = 3.6
  const RADIUS = 1

  it('is fully visible (1) for a point facing the camera directly', () => {
    const cameraPosition: [number, number, number] = [0, 0, CAMERA_DISTANCE]
    expect(sphereMarkerVisibility([0, 0, 1], cameraPosition, RADIUS)).toBe(1)
  })

  it('is fully hidden (0) for a point on the far side, directly away from the camera', () => {
    const cameraPosition: [number, number, number] = [0, 0, CAMERA_DISTANCE]
    expect(sphereMarkerVisibility([0, 0, -1], cameraPosition, RADIUS)).toBe(0)
  })

  it('fades smoothly through an intermediate band near the true horizon, not a hard cutoff', () => {
    const cameraPosition: [number, number, number] = [0, 0, CAMERA_DISTANCE]
    // A point exactly at the geometric horizon (cosAngle == radius/distance).
    const thresholdCos = RADIUS / CAMERA_DISTANCE
    const horizonAngle = Math.acos(thresholdCos)
    const direction: [number, number, number] = [Math.sin(horizonAngle), 0, Math.cos(horizonAngle)]
    const visibility = sphereMarkerVisibility(direction, cameraPosition, RADIUS)
    expect(visibility).toBeGreaterThan(0)
    expect(visibility).toBeLessThan(1)
  })

  it('is 0 when the camera sits at the origin (degenerate, avoids division by zero)', () => {
    expect(sphereMarkerVisibility([0, 0, 1], [0, 0, 0], RADIUS)).toBe(0)
  })
})

// --------------------------------------------------------------------- transient timing

describe('arrivalTimingFor', () => {
  it('scales every width linearly with baseRate', () => {
    const a = arrivalTimingFor(0.02)
    const b = arrivalTimingFor(0.04)
    expect(b.minArcWarp).toBeCloseTo(a.minArcWarp * 2)
    expect(b.minTailWarp).toBeCloseTo(a.minTailWarp * 2)
    expect(b.landingWarp).toBeCloseTo(a.landingWarp * 2)
    expect(b.inhabitedFadeWarp).toBeCloseTo(a.inhabitedFadeWarp * 2)
  })

  it('gives every width 0 at baseRate 0', () => {
    expect(arrivalTimingFor(0)).toEqual({ minArcWarp: 0, minTailWarp: 0, landingWarp: 0, inhabitedFadeWarp: 0 })
  })

  it('treats a negative baseRate the same as 0 (clamped, never a negative width)', () => {
    expect(arrivalTimingFor(-1)).toEqual({ minArcWarp: 0, minTailWarp: 0, landingWarp: 0, inhabitedFadeWarp: 0 })
  })
})

/** The `t` at which `arrivalPresentationAt`'s own tail decay reaches exactly 0 — the same
 *  computation `arrivalPresentationAt` performs internally, replicated here from its own public
 *  `ArrivalTiming` fields so the legibility guarantee below can be checked from outside. */
function tailFadeEnd(effect: ArrivalGlobeEffect, timing: ArrivalTiming): GeoTime {
  const window = effect.windows.find((w) => w.tMin === 0)!
  const establishedWarp = symlogWarp(effect.established)
  const travelWarp = Math.max(0, symlogWarp(window.tMax) - establishedWarp)
  const tailWarp = Math.max(timing.minTailWarp, timing.minArcWarp - travelWarp)
  return SYMLOG_C * Math.expm1(establishedWarp - tailWarp)
}

describe('arrivalPresentationAt', () => {
  const BASE_RATE = 0.05
  const timing = arrivalTimingFor(BASE_RATE)

  it('is hidden above the window’s own tMax', () => {
    const t = OUT_OF_AFRICA.windows[0]!.tMax + 1
    expect(arrivalPresentationAt(OUT_OF_AFRICA, t, timing)).toEqual({
      arcAlpha: 0,
      travelling: false,
      travelProgress: 0,
      settleProgress: 0,
      inhabited: 0,
    })
  })

  it('draws the arc at full strength while travelling, from tMax through established', () => {
    const { established, windows } = OUT_OF_AFRICA
    for (const t of [windows[0]!.tMax, (established + windows[0]!.tMax) / 2, established]) {
      expect(arrivalPresentationAt(OUT_OF_AFRICA, t, timing).arcAlpha).toBe(1)
      expect(arrivalPresentationAt(OUT_OF_AFRICA, t, timing).travelling).toBe(true)
    }
  })

  it('travelProgress runs 0 at tMax to 1 at established', () => {
    const { established, windows } = OUT_OF_AFRICA
    expect(arrivalPresentationAt(OUT_OF_AFRICA, windows[0]!.tMax, timing).travelProgress).toBe(0)
    expect(arrivalPresentationAt(OUT_OF_AFRICA, established, timing).travelProgress).toBe(1)
  })

  it('decays arcAlpha monotonically to 0 across the tail below established', () => {
    const { established } = OUT_OF_AFRICA
    const fadeEnd = tailFadeEnd(OUT_OF_AFRICA, timing)
    expect(fadeEnd).toBeGreaterThan(0)
    expect(fadeEnd).toBeLessThan(established)

    let previous = arrivalPresentationAt(OUT_OF_AFRICA, established, timing).arcAlpha
    expect(previous).toBe(1)
    const steps = 8
    for (let i = 1; i <= steps; i++) {
      const t = established - ((established - fadeEnd) * i) / steps
      const alpha = arrivalPresentationAt(OUT_OF_AFRICA, t, timing).arcAlpha
      expect(alpha).toBeLessThanOrEqual(previous + 1e-9)
      previous = alpha
    }
    expect(arrivalPresentationAt(OUT_OF_AFRICA, fadeEnd, timing).arcAlpha).toBeCloseTo(0, 5)
    expect(arrivalPresentationAt(OUT_OF_AFRICA, Math.max(0, fadeEnd - 5000), timing).arcAlpha).toBe(0)
  })

  it('guarantees at least ~MIN_ARC_SECONDS of playback even for a near-instantaneous arrival', () => {
    // established sits one year below tMax: almost no travel span, so the whole guarantee has to
    // come from the tail alone.
    const shortWindow: ArrivalGlobeEffect = {
      kind: 'arrival',
      arrivalKind: 'migration',
      origin: { lat: 0, lon: 0 },
      destination: { lat: 1, lon: 1 },
      established: 60_000,
      windows: [{ tMin: 0, tMax: 60_001 }],
    }
    const fadeEnd = tailFadeEnd(shortWindow, timing)
    expect(arrivalPresentationAt(shortWindow, fadeEnd, timing).arcAlpha).toBeCloseTo(0, 4)

    const seconds =
      (symlogWarp(shortWindow.windows[0]!.tMax) - symlogWarp(fadeEnd)) / (BASE_RATE * symlogWarp(EARTH_FORMATION))
    expect(seconds).toBeGreaterThanOrEqual(1.0)
  })

  it('settleProgress is 0 at and above established, rising to 1 a landingWarp past it', () => {
    const { established } = OUT_OF_AFRICA
    expect(arrivalPresentationAt(OUT_OF_AFRICA, established, timing).settleProgress).toBe(0)
    expect(arrivalPresentationAt(OUT_OF_AFRICA, established + 5000, timing).settleProgress).toBe(0)

    const establishedWarp = symlogWarp(established)
    const wellPast = SYMLOG_C * Math.expm1(establishedWarp - timing.landingWarp)
    expect(arrivalPresentationAt(OUT_OF_AFRICA, wellPast, timing).settleProgress).toBe(1)

    const midway = SYMLOG_C * Math.expm1(establishedWarp - timing.landingWarp / 2)
    const mid = arrivalPresentationAt(OUT_OF_AFRICA, midway, timing).settleProgress
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
  })

  it('inhabited stays 0 for a migration and tracks settleProgress for a peopling while it is still rising', () => {
    const migration: ArrivalGlobeEffect = { ...OUT_OF_AFRICA, arrivalKind: 'migration' }
    const peopling: ArrivalGlobeEffect = { ...OUT_OF_AFRICA, arrivalKind: 'peopling' }
    const t = OUT_OF_AFRICA.established - 1000

    expect(arrivalPresentationAt(migration, t, timing).inhabited).toBe(0)
    const presentation = arrivalPresentationAt(peopling, t, timing)
    expect(presentation.inhabited).toBe(presentation.settleProgress)
    expect(presentation.inhabited).toBeGreaterThan(0)
  })

  it('inhabited rises to 1 exactly at the landing, then fades back to 0 over inhabitedFadeWarp — it does not persist', () => {
    const peopling: ArrivalGlobeEffect = { ...OUT_OF_AFRICA, arrivalKind: 'peopling' }
    const establishedWarp = symlogWarp(peopling.established)

    const atLanding = SYMLOG_C * Math.expm1(establishedWarp - timing.landingWarp)
    expect(arrivalPresentationAt(peopling, atLanding, timing).inhabited).toBeCloseTo(1, 5)

    const fadeEnd = SYMLOG_C * Math.expm1(establishedWarp - timing.landingWarp - timing.inhabitedFadeWarp)
    expect(fadeEnd).toBeGreaterThan(0)
    expect(arrivalPresentationAt(peopling, fadeEnd, timing).inhabited).toBeCloseTo(0, 5)
    expect(arrivalPresentationAt(peopling, Math.max(0, fadeEnd - 5000), timing).inhabited).toBe(0)

    let previous = 1
    const steps = 8
    for (let i = 1; i <= steps; i++) {
      const warpPastLanding = timing.landingWarp + (timing.inhabitedFadeWarp * i) / steps
      const t = SYMLOG_C * Math.expm1(establishedWarp - warpPastLanding)
      const inhabited = arrivalPresentationAt(peopling, t, timing).inhabited
      expect(inhabited).toBeLessThanOrEqual(previous + 1e-9)
      previous = inhabited
    }
  })

  it('is pure across the fade-out too: scrubbing back into it and away reproduces the same value', () => {
    const peopling: ArrivalGlobeEffect = { ...OUT_OF_AFRICA, arrivalKind: 'peopling' }
    const establishedWarp = symlogWarp(peopling.established)
    const midFade = SYMLOG_C * Math.expm1(establishedWarp - timing.landingWarp - timing.inhabitedFadeWarp / 2)

    const first = arrivalPresentationAt(peopling, midFade, timing)
    arrivalPresentationAt(peopling, OUT_OF_AFRICA.windows[0]!.tMax, timing)
    arrivalPresentationAt(peopling, 0, timing)
    expect(arrivalPresentationAt(peopling, midFade, timing)).toEqual(first)
  })

  it('is pure: the same t gives the same result regardless of call order', () => {
    const t1 = OUT_OF_AFRICA.established - 2000
    const t2 = OUT_OF_AFRICA.windows[0]!.tMax - 500
    const first = arrivalPresentationAt(OUT_OF_AFRICA, t1, timing)
    arrivalPresentationAt(OUT_OF_AFRICA, t2, timing)
    arrivalPresentationAt(OUT_OF_AFRICA, OUT_OF_AFRICA.windows[0]!.tMax, timing)
    const again = arrivalPresentationAt(OUT_OF_AFRICA, t1, timing)
    expect(again).toEqual(first)
  })
})

describe('hasVisibleArrivals', () => {
  const BASE_RATE = 0.05
  const timing = arrivalTimingFor(BASE_RATE)

  function eventFor(effect: ArrivalGlobeEffect): TimelineEvent {
    return {
      id: 'out-of-africa-migration',
      label: 'Out of Africa',
      tMin: 5e4,
      tMax: 7e4,
      importance: 0.8,
      description: 'd',
      citation: 'c',
      effect,
    }
  }

  it('is true while an arc is being drawn', () => {
    expect(hasVisibleArrivals([eventFor(OUT_OF_AFRICA)], OUT_OF_AFRICA.established, timing)).toBe(true)
  })

  it('is false above every arrival’s own tMax', () => {
    const t = OUT_OF_AFRICA.windows[0]!.tMax + 1
    expect(hasVisibleArrivals([eventFor(OUT_OF_AFRICA)], t, timing)).toBe(false)
  })

  it('is false at the present for a peopling arrival established tens of thousands of years ago: its arc, ripple and inhabited marker have all fully faded by then, none of them persists', () => {
    const migration = eventFor({ ...OUT_OF_AFRICA, arrivalKind: 'migration' })
    const peopling = eventFor({ ...OUT_OF_AFRICA, arrivalKind: 'peopling' })
    expect(hasVisibleArrivals([migration], 0, timing)).toBe(false)
    expect(hasVisibleArrivals([peopling], 0, timing)).toBe(false)
  })

  it('is true for a peopling arrival while its inhabited marker is still settling or fading, even after arcAlpha has reached 0', () => {
    const peopling = eventFor({ ...OUT_OF_AFRICA, arrivalKind: 'peopling' })
    const establishedWarp = symlogWarp(OUT_OF_AFRICA.established)
    const stillFading = SYMLOG_C * Math.expm1(establishedWarp - timing.landingWarp - timing.inhabitedFadeWarp / 2)
    expect(hasVisibleArrivals([peopling], stillFading, timing)).toBe(true)
  })

  it('ignores events with no arrival effect', () => {
    const other: TimelineEvent = { id: 'x', label: 'X', tMin: 0, tMax: 1, importance: 0.1, description: 'd', citation: 'c' }
    expect(hasVisibleArrivals([other], 0, timing)).toBe(false)
  })
})

describe('arrivalWindow', () => {
  it('returns [established, tMax] — the TimeWindow order formatTimeRange expects', () => {
    expect(arrivalWindow(OUT_OF_AFRICA)).toEqual([OUT_OF_AFRICA.established, OUT_OF_AFRICA.windows[0]!.tMax])
  })
})

// ------------------------------------------------------------------------- the arrival chain

describe('buildArrivalIndex and traceToOrigin', () => {
  const AFRICA_ORIGIN: ArrivalGlobeEffect = {
    kind: 'arrival',
    arrivalKind: 'peopling',
    origin: { lat: 9.0, lon: 34.0 },
    destination: { lat: 9.0, lon: 34.0 },
    established: 3.15e5,
    windows: [{ tMin: 0, tMax: 3.15e5 }],
  }
  const LEVANT: ArrivalGlobeEffect = {
    kind: 'arrival',
    arrivalKind: 'peopling',
    origin: { lat: 9.0, lon: 34.0 },
    destination: { lat: 31.5, lon: 35.0 },
    established: 1.9e5,
    windows: [{ tMin: 0, tMax: 2.0e5 }],
  }
  const ASIA: ArrivalGlobeEffect = {
    kind: 'arrival',
    arrivalKind: 'peopling',
    origin: { lat: 31.5, lon: 35.0 },
    destination: { lat: 60.0, lon: 90.0 },
    established: 1.0e5,
    windows: [{ tMin: 0, tMax: 1.2e5 }],
  }

  function eventFor(id: string, effect: ArrivalGlobeEffect): TimelineEvent {
    return { id, label: id, tMin: effect.established, tMax: effect.windows[0]!.tMax, importance: 0.5, description: 'd', citation: 'c', effect }
  }

  const EVENTS: TimelineEvent[] = [eventFor('africa-origin', AFRICA_ORIGIN), eventFor('levant-arrival', LEVANT), eventFor('asia-arrival', ASIA)]

  it('sorts records ascending by established — newest arrival first, origin last', () => {
    const index = buildArrivalIndex(EVENTS)
    expect(index.records.map((r) => r.eventId)).toEqual(['asia-arrival', 'levant-arrival', 'africa-origin'])
  })

  it('links each arrival to the older arrival whose destination sits nearest its own origin', () => {
    const index = buildArrivalIndex(EVENTS)
    expect(index.byEventId.get('asia-arrival')?.parentEventId).toBe('levant-arrival')
    expect(index.byEventId.get('levant-arrival')?.parentEventId).toBe('africa-origin')
  })

  it('gives the degenerate origin arrival no parent', () => {
    const index = buildArrivalIndex(EVENTS)
    expect(index.byEventId.get('africa-origin')?.parentEventId).toBeNull()
  })

  it('breaks a distance tie deterministically by eventId', () => {
    // Two equally-old candidate parents whose destination is exactly ASIA's own origin — the
    // tie must resolve to the lexicographically smaller id, not whichever happened to be listed
    // first.
    const tiedOlder: ArrivalGlobeEffect = { ...LEVANT, established: 2.5e5, windows: [{ tMin: 0, tMax: 2.6e5 }] }
    const events = [eventFor('z-tied-parent', tiedOlder), eventFor('a-tied-parent', tiedOlder), eventFor('asia-arrival', ASIA)]
    const index = buildArrivalIndex(events)
    expect(index.byEventId.get('asia-arrival')?.parentEventId).toBe('a-tied-parent')
  })

  it('traces the full chain, hovered-first and origin-last', () => {
    const index = buildArrivalIndex(EVENTS)
    expect(traceToOrigin(index, 'asia-arrival')).toEqual(['asia-arrival', 'levant-arrival', 'africa-origin'])
  })

  it('a chain rooted at the origin itself is just the origin', () => {
    const index = buildArrivalIndex(EVENTS)
    expect(traceToOrigin(index, 'africa-origin')).toEqual(['africa-origin'])
  })

  it('terminates and returns [] for an unknown id', () => {
    const index = buildArrivalIndex(EVENTS)
    expect(traceToOrigin(index, 'no-such-arrival')).toEqual([])
  })
})
