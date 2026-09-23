import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION } from '@/types/layer'
import type { ArrivalGlobeEffect, GeoTime, GlobeEffectAnchor, TimelineEvent } from '@/types/layer'

import {
  type ArrivalTiming,
  arrivalPresentationAt,
  arrivalTimingFor,
  arrivalWindow,
  arrowheadPlacementAt,
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
import { lonLatToSphere } from './projection'

function withDistance(points: readonly GlobeEffectAnchor[]): DistancedAnchor[] {
  const denom = Math.max(points.length - 1, 1)
  return points.map((p, i) => ({ ...p, distance: i / denom }))
}

function arrival(overrides: Partial<ArrivalGlobeEffect> = {}): ArrivalGlobeEffect {
  return {
    kind: 'arrival',
    arrivalKind: 'migration',
    origin: { lat: 9.0, lon: 42.0 },
    destination: { lat: 20.0, lon: 48.0 },
    established: 6.0e4,
    windows: [{ tMin: 0, tMax: 7.0e4 }],
    ...overrides,
  }
}

const OUT_OF_AFRICA = arrival()
const PEOPLING = arrival({ arrivalKind: 'peopling' })
// A great circle between these crosses the antimeridian.
const BERINGIA_TO_AMERICAS = arrival({ origin: { lat: 65, lon: 170 }, destination: { lat: 55, lon: -130 } })
const DEGENERATE = arrival({ origin: { lat: 9, lon: 34 }, destination: { lat: 9, lon: 34 } })

function event(id: string, effect?: ArrivalGlobeEffect): TimelineEvent {
  return { id, label: id, tMin: 0, tMax: 1, importance: 0.5, description: 'd', citation: 'c', effect }
}

/** t at a given symlog-warp distance below `established`. */
function warpBelow(effect: ArrivalGlobeEffect, warp: number): GeoTime {
  return SYMLOG_C * Math.expm1(symlogWarp(effect.established) - warp)
}

/** The t at which the arc's tail decay reaches 0, derived from the public timing fields. */
function tailFadeEnd(effect: ArrivalGlobeEffect, timing: ArrivalTiming): GeoTime {
  const travelWarp = Math.max(0, symlogWarp(effect.windows[0]!.tMax) - symlogWarp(effect.established))
  return warpBelow(effect, Math.max(timing.minTailWarp, timing.minArcWarp - travelWarp))
}

describe('arc geometry', () => {
  it('samples a great circle from origin to destination, a single point when degenerate', () => {
    const points = greatCircleLonLatPoints(OUT_OF_AFRICA.origin, OUT_OF_AFRICA.destination, 8)
    expect(points).toHaveLength(9)
    expect(points[0]).toEqual(OUT_OF_AFRICA.origin)
    expect(points.at(-1)).toEqual(OUT_OF_AFRICA.destination)
    expect(greatCircleLonLatPoints(DEGENERATE.origin, DEGENERATE.destination, 8)).toEqual([DEGENERATE.origin])
    expect(isDegenerateArrival(DEGENERATE)).toBe(true)
    expect(isDegenerateArrival(OUT_OF_AFRICA)).toBe(false)
  })

  it('splits at the antimeridian with cumulative distance continuous across the split', () => {
    const geometry = buildArrivalArcGeometry('beringia', BERINGIA_TO_AMERICAS)
    expect(geometry.segments.length).toBeGreaterThanOrEqual(2)
    for (const segment of geometry.segments) {
      for (let i = 1; i < segment.length; i++) expect(Math.abs(segment[i]!.lon - segment[i - 1]!.lon)).toBeLessThanOrEqual(180)
    }
    const flat = geometry.segments.flat()
    expect(flat[0]!.distance).toBe(0)
    expect(flat.at(-1)!.distance).toBe(1)
    for (let i = 1; i < flat.length; i++) expect(flat[i]!.distance).toBeGreaterThanOrEqual(flat[i - 1]!.distance)
  })

  it('keeps a non-crossing arc whole and a degenerate one segment-free', () => {
    expect(buildArrivalArcGeometry('ooa', OUT_OF_AFRICA).segments).toHaveLength(1)
    expect(buildArrivalArcGeometry('origin', DEGENERATE)).toMatchObject({ isDegenerate: true, segments: [] })
  })
})

describe('buildFatLineBuffers', () => {
  it('emits two side vertices per point sharing distance and tangents, two triangles per span', () => {
    const points = withDistance(greatCircleLonLatPoints(OUT_OF_AFRICA.origin, OUT_OF_AFRICA.destination, 5))
    const buffers = buildFatLineBuffers(points)
    expect(buffers.side).toHaveLength(points.length * 2)
    expect(buffers.indices).toHaveLength((points.length - 1) * 6)
    for (const idx of buffers.indices) expect(idx).toBeLessThan(points.length * 2)
    for (let i = 0; i < points.length; i++) {
      const [l, r] = [i * 2, i * 2 + 1]
      expect([buffers.side[l], buffers.side[r]]).toEqual([-1, 1])
      expect(buffers.distance[l]).toBe(buffers.distance[r])
      expect(buffers.lonLat[i * 4]).toBeCloseTo(points[i]!.lon)
      expect(buffers.dirA[l * 2]).toBe(buffers.dirA[r * 2])
      expect(buffers.dirB[l * 2 + 1]).toBe(buffers.dirB[r * 2 + 1])
    }
    expect(buffers.dirA[0]).toBeCloseTo(points[0]!.lon)
    expect(buffers.dirB[(points.length - 1) * 4]).toBeCloseTo(points.at(-1)!.lon)
  })

  it("passes each point's own distance through for split pieces", () => {
    const buffers = buildFatLineBuffers([
      { lat: 0, lon: -20, distance: 0.4 },
      { lat: 5, lon: -10, distance: 0.55 },
      { lat: 10, lon: 0, distance: 0.7 },
    ])
    ;[0.4, 0.4, 0.55, 0.55, 0.7, 0.7].forEach((v, i) => expect(buffers.distance[i]).toBeCloseTo(v, 5))
  })
})

describe('sphereMarkerVisibility', () => {
  const cam: [number, number, number] = [0, 0, 3.6]

  it('is 1 facing the camera, 0 behind, and fades through the horizon', () => {
    expect(sphereMarkerVisibility([0, 0, 1], cam, 1)).toBe(1)
    expect(sphereMarkerVisibility([0, 0, -1], cam, 1)).toBe(0)
    const a = Math.acos(1 / 3.6)
    const v = sphereMarkerVisibility([Math.sin(a), 0, Math.cos(a)], cam, 1)
    expect(v).toBeGreaterThan(0)
    expect(v).toBeLessThan(1)
    expect(sphereMarkerVisibility([0, 0, 1], [0, 0, 0], 1)).toBe(0)
  })
})

describe('arrivalTimingFor', () => {
  it('scales linearly with baseRate and clamps negatives to zero', () => {
    const a = arrivalTimingFor(0.02)
    const b = arrivalTimingFor(0.04)
    for (const key of ['minArcWarp', 'minTailWarp', 'landingWarp', 'inhabitedFadeWarp'] as const) {
      expect(b[key]).toBeCloseTo(a[key] * 2)
    }
    expect(arrivalTimingFor(-1)).toEqual({ minArcWarp: 0, minTailWarp: 0, landingWarp: 0, inhabitedFadeWarp: 0 })
  })
})

describe('arrivalPresentationAt', () => {
  const BASE_RATE = 0.05
  const timing = arrivalTimingFor(BASE_RATE)
  const tMax = OUT_OF_AFRICA.windows[0]!.tMax
  const { established } = OUT_OF_AFRICA

  it('is hidden above tMax', () => {
    expect(arrivalPresentationAt(OUT_OF_AFRICA, tMax + 1, timing)).toEqual({
      arcAlpha: 0,
      travelling: false,
      travelProgress: 0,
      settleProgress: 0,
      inhabited: 0,
    })
  })

  it('travels at full alpha from tMax (progress 0) to established (progress 1)', () => {
    for (const t of [tMax, (established + tMax) / 2, established]) {
      expect(arrivalPresentationAt(OUT_OF_AFRICA, t, timing)).toMatchObject({ arcAlpha: 1, travelling: true })
    }
    expect(arrivalPresentationAt(OUT_OF_AFRICA, tMax, timing).travelProgress).toBe(0)
    expect(arrivalPresentationAt(OUT_OF_AFRICA, established, timing).travelProgress).toBe(1)
  })

  it('fades arcAlpha monotonically to 0 over the tail while travelProgress stays 1', () => {
    const fadeEnd = tailFadeEnd(OUT_OF_AFRICA, timing)
    expect(fadeEnd).toBeGreaterThan(0)
    expect(fadeEnd).toBeLessThan(established)
    let previous = 1
    for (let i = 1; i <= 8; i++) {
      const p = arrivalPresentationAt(OUT_OF_AFRICA, established - ((established - fadeEnd) * i) / 8, timing)
      expect(p.arcAlpha).toBeLessThanOrEqual(previous + 1e-9)
      expect(p.travelProgress).toBe(1)
      previous = p.arcAlpha
    }
    expect(arrivalPresentationAt(OUT_OF_AFRICA, fadeEnd, timing).arcAlpha).toBeCloseTo(0, 5)
    expect(arrivalPresentationAt(OUT_OF_AFRICA, Math.max(0, fadeEnd - 5000), timing).arcAlpha).toBe(0)
  })

  it('guarantees at least a second of playback for a near-instantaneous arrival', () => {
    const short = arrival({ established: 60_000, windows: [{ tMin: 0, tMax: 60_001 }] })
    const fadeEnd = tailFadeEnd(short, timing)
    expect(arrivalPresentationAt(short, fadeEnd, timing).arcAlpha).toBeCloseTo(0, 4)
    const seconds = (symlogWarp(60_001) - symlogWarp(fadeEnd)) / (BASE_RATE * symlogWarp(EARTH_FORMATION))
    expect(seconds).toBeGreaterThanOrEqual(1.0)
  })

  it('settles from 0 at established to 1 a landingWarp later', () => {
    expect(arrivalPresentationAt(OUT_OF_AFRICA, established + 5000, timing).settleProgress).toBe(0)
    expect(arrivalPresentationAt(OUT_OF_AFRICA, established, timing).settleProgress).toBe(0)
    const mid = arrivalPresentationAt(OUT_OF_AFRICA, warpBelow(OUT_OF_AFRICA, timing.landingWarp / 2), timing).settleProgress
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
    expect(arrivalPresentationAt(OUT_OF_AFRICA, warpBelow(OUT_OF_AFRICA, timing.landingWarp), timing).settleProgress).toBe(1)
  })

  it('marks inhabited only for peopling, rising to 1 at landing then fading back to 0', () => {
    expect(arrivalPresentationAt(OUT_OF_AFRICA, established - 1000, timing).inhabited).toBe(0)
    const rising = arrivalPresentationAt(PEOPLING, established - 1000, timing)
    expect(rising.inhabited).toBeGreaterThan(0)
    expect(rising.inhabited).toBe(rising.settleProgress)
    expect(arrivalPresentationAt(PEOPLING, warpBelow(PEOPLING, timing.landingWarp), timing).inhabited).toBeCloseTo(1, 5)
    let previous = 1
    for (let i = 1; i <= 8; i++) {
      const inhabited = arrivalPresentationAt(PEOPLING, warpBelow(PEOPLING, timing.landingWarp + (timing.inhabitedFadeWarp * i) / 8), timing).inhabited
      expect(inhabited).toBeLessThanOrEqual(previous + 1e-9)
      previous = inhabited
    }
    expect(previous).toBeCloseTo(0, 5)
  })

  it('is pure in t regardless of call order', () => {
    const t = warpBelow(PEOPLING, timing.landingWarp + timing.inhabitedFadeWarp / 2)
    const first = arrivalPresentationAt(PEOPLING, t, timing)
    arrivalPresentationAt(PEOPLING, tMax, timing)
    arrivalPresentationAt(PEOPLING, 0, timing)
    expect(arrivalPresentationAt(PEOPLING, t, timing)).toEqual(first)
  })

  describe('near the present', () => {
    const slow = arrivalTimingFor(0.02)
    const recent = (established: GeoTime, arrivalKind: ArrivalGlobeEffect['arrivalKind']) =>
      arrival({ arrivalKind, destination: { lat: 64, lon: -21 }, established, windows: [{ tMin: 0, tMax: established * 1.4 }] })

    it.each([745, 1148, 2.5e4, 1.85e5])('leaves nothing lit at t = 0 for an arrival established at %i', (established) => {
      expect(arrivalPresentationAt(recent(established, 'migration'), 0, slow).arcAlpha).toBeCloseTo(0, 5)
      const p = arrivalPresentationAt(recent(established, 'peopling'), 0, slow)
      expect(p.arcAlpha).toBeCloseTo(0, 5)
      expect(p.inhabited).toBeCloseTo(0, 5)
    })

    it('still shows arc and marker just after a recent landing', () => {
      expect(arrivalPresentationAt(recent(1148, 'migration'), 900, slow).arcAlpha).toBeGreaterThan(0)
      expect(arrivalPresentationAt(recent(1148, 'peopling'), 1000, slow).inhabited).toBeGreaterThan(0)
    })
  })
})

describe('hasVisibleArrivals', () => {
  const timing = arrivalTimingFor(0.05)

  it('is true while an arc or inhabited marker shows, false before and long after', () => {
    expect(hasVisibleArrivals([event('a', OUT_OF_AFRICA)], OUT_OF_AFRICA.established, timing)).toBe(true)
    expect(hasVisibleArrivals([event('a', OUT_OF_AFRICA)], OUT_OF_AFRICA.windows[0]!.tMax + 1, timing)).toBe(false)
    expect(hasVisibleArrivals([event('a', OUT_OF_AFRICA), event('b', PEOPLING)], 0, timing)).toBe(false)
    const fading = warpBelow(PEOPLING, timing.landingWarp + timing.inhabitedFadeWarp / 2)
    expect(hasVisibleArrivals([event('b', PEOPLING)], fading, timing)).toBe(true)
    expect(hasVisibleArrivals([event('x')], 0, timing)).toBe(false)
  })
})

describe('arrivalWindow', () => {
  it('returns [established, tMax]', () => {
    expect(arrivalWindow(OUT_OF_AFRICA)).toEqual([6.0e4, 7.0e4])
  })
})

describe('buildArrivalIndex and traceToOrigin', () => {
  const ORIGIN = arrival({ arrivalKind: 'peopling', origin: { lat: 9, lon: 34 }, destination: { lat: 9, lon: 34 }, established: 3.15e5, windows: [{ tMin: 0, tMax: 3.15e5 }] })
  const LEVANT = arrival({ origin: { lat: 9, lon: 34 }, destination: { lat: 31.5, lon: 35 }, established: 1.9e5, windows: [{ tMin: 0, tMax: 2.0e5 }] })
  const ASIA = arrival({ origin: { lat: 31.5, lon: 35 }, destination: { lat: 60, lon: 90 }, established: 1.0e5, windows: [{ tMin: 0, tMax: 1.2e5 }] })
  const index = buildArrivalIndex([event('origin', ORIGIN), event('levant', LEVANT), event('asia', ASIA)])

  it('sorts newest first and links each arrival to the nearest older destination', () => {
    expect(index.records.map((r) => r.eventId)).toEqual(['asia', 'levant', 'origin'])
    expect(index.byEventId.get('asia')?.parentEventId).toBe('levant')
    expect(index.byEventId.get('levant')?.parentEventId).toBe('origin')
    expect(index.byEventId.get('origin')?.parentEventId).toBeNull()
  })

  it('breaks a distance tie by eventId', () => {
    const tied = { ...LEVANT, established: 2.5e5, windows: [{ tMin: 0, tMax: 2.6e5 }] }
    const tiedIndex = buildArrivalIndex([event('z', tied), event('a', tied), event('asia', ASIA)])
    expect(tiedIndex.byEventId.get('asia')?.parentEventId).toBe('a')
  })

  it('traces hovered-first to origin-last, [] for an unknown id', () => {
    expect(traceToOrigin(index, 'asia')).toEqual(['asia', 'levant', 'origin'])
    expect(traceToOrigin(index, 'origin')).toEqual(['origin'])
    expect(traceToOrigin(index, 'ghost')).toEqual([])
  })
})

describe('arrowheadPlacementAt', () => {
  const angle = (a: readonly number[], b: readonly number[]) =>
    Math.acos(Math.min(1, Math.max(-1, a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!)))

  it('is null for a degenerate arrival', () => {
    expect(arrowheadPlacementAt(DEGENERATE, 0.5)).toBeNull()
  })

  it('runs origin to destination, clamping progress outside 0..1', () => {
    expect(arrowheadPlacementAt(OUT_OF_AFRICA, 0)!.anchor).toEqual(OUT_OF_AFRICA.origin)
    expect(arrowheadPlacementAt(OUT_OF_AFRICA, -0.5)!.anchor).toEqual(OUT_OF_AFRICA.origin)
    for (const p of [1, 1.5]) {
      const { anchor } = arrowheadPlacementAt(OUT_OF_AFRICA, p)!
      expect(anchor.lat).toBeCloseTo(OUT_OF_AFRICA.destination.lat, 6)
      expect(anchor.lon).toBeCloseTo(OUT_OF_AFRICA.destination.lon, 6)
    }
  })

  it('points toward the destination with the tail behind, clamped at the origin', () => {
    const { anchor, tail } = arrowheadPlacementAt(OUT_OF_AFRICA, 0.5)!
    const dest = lonLatToSphere(OUT_OF_AFRICA.destination)
    expect(angle(lonLatToSphere(anchor), dest)).toBeLessThan(angle(lonLatToSphere(tail), dest))
    const early = arrowheadPlacementAt(OUT_OF_AFRICA, 0.005)!
    expect(angle(lonLatToSphere(early.tail), lonLatToSphere(OUT_OF_AFRICA.origin))).toBeCloseTo(0, 3)
  })
})
