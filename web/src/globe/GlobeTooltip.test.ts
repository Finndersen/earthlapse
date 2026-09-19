import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { arrivalPresentationAt, arrivalTimingFor, buildArrivalArcGeometry } from './arcs'
import { pickCandidate, sameHitTarget, type GlobeHitCandidate, type GlobeHitTarget } from './GlobeTooltip'
import { ARC_MAP_LIFT, ARC_SPHERE_LIFT, MARKER_MAP_LIFT, MARKER_SPHERE_LIFT } from './humanStyle'
import { EQUAL_EARTH_HALF_HEIGHT, EQUAL_EARTH_HALF_WIDTH, unfoldedLiftedPosition } from './projection'
import type { ArrivalGlobeEffect } from '@/types/layer'

/**
 * Regression coverage for a Melbourne hover reported as unreliable. Real data, no browser: the
 * "British colonisation of Australia" arrival (`data/events.yaml`) is a `migration` from
 * Portsmouth (50.8, -1.1) to a schematic Sydney destination (-33.85, 151.2) — 2 km from the real,
 * curated Sydney city point (-33.86785, 151.20732) — while Melbourne (-37.814, 144.96332) sits
 * ~713 km further southwest. `HumanCivilisation.tsx` registers that arc's *whole polyline* as one
 * `GlobeHitCandidate` whenever `arcAlpha > 0` (`arrivalPresentationAt`), with `ARC_TOLERANCE_PX =
 * 7` — a plausible collision with Melbourne's own dot. This checks it against the real geometry
 * rather than a screen scan: a colour-based pixel scan over a photoreal basemap is exactly the
 * "drawnBounds is worthless over a busy backdrop" trap `CLAUDE.md` warns about, and never reliably
 * resolved Melbourne's own dot.
 */

// `data/events.yaml`'s `british-colonisation-australia` `effect:` block, verbatim.
const BRITISH_COLONISATION_EFFECT: ArrivalGlobeEffect = {
  kind: 'arrival',
  arrivalKind: 'migration',
  origin: { lat: 50.8, lon: -1.1 },
  destination: { lat: -33.85, lon: 151.2 },
  established: 237,
  windows: [{ tMin: 0, tMax: 238 }],
}

// `data/media/layers/cities.json`'s curated points — the real city geometry, not the arrival's
// own schematic destination.
const MELBOURNE = { lat: -37.814, lon: 144.96332 }
const SYDNEY = { lat: -33.86785, lon: 151.20732 }

// `HumanCivilisation.tsx`'s own tolerance constants, copied verbatim (not exported): this test's
// own assertions would simply test the wrong numbers if that file's copy ever drifts from these.
const ARC_TOLERANCE_PX = 7
const MARKER_TOLERANCE_PX = 11

const GLOBE_RADIUS = 1 // Globe.tsx's own GLOBE_RADIUS
// Globe.tsx's own map-mode fit: a PerspectiveCamera at fov 40 backed off far enough that the
// Equal Earth map's own half-extents (+3% margin, Globe.tsx's MAP_FIT_MARGIN) fill the viewport —
// reproduced by hand since Globe.tsx's own camera-framing constants aren't exported; camera.ts's
// pure `fitDistance` is the same formula `GlobeCameraControls` calls.
function mapFitDistance(aspect: number): number {
  const fovYRadians = (40 * Math.PI) / 180
  const margin = 0.03
  const halfHeight = EQUAL_EARTH_HALF_HEIGHT * GLOBE_RADIUS * (1 + margin)
  const halfWidth = EQUAL_EARTH_HALF_WIDTH * GLOBE_RADIUS * (1 + margin)
  const distanceForHeight = halfHeight / Math.tan(fovYRadians / 2)
  const halfFovX = Math.atan(Math.tan(fovYRadians / 2) * aspect)
  const distanceForWidth = halfWidth / Math.tan(halfFovX)
  return Math.max(distanceForHeight, distanceForWidth)
}

function makeMapCamera(width: number, height: number): THREE.PerspectiveCamera {
  const aspect = width / height
  const camera = new THREE.PerspectiveCamera(40, aspect, 0.01, 100)
  camera.position.set(0, 0, mapFitDistance(aspect))
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  return camera
}

function cityCandidate(id: string, title: string, point: { lat: number; lon: number }): GlobeHitCandidate {
  const target: GlobeHitTarget = {
    kind: 'city',
    id: `city:${id}`,
    eventId: null,
    title,
    description: '',
    dateRange: '',
    anchor: point,
  }
  return { content: () => target, points: [point], tolerancePx: MARKER_TOLERANCE_PX, sphereLift: MARKER_SPHERE_LIFT, mapLift: MARKER_MAP_LIFT }
}

function arrivalArcCandidates(): GlobeHitCandidate[] {
  const geometry = buildArrivalArcGeometry('british-colonisation-australia', BRITISH_COLONISATION_EFFECT)
  const target: GlobeHitTarget = {
    kind: 'arrival',
    id: 'arrival:british-colonisation-australia',
    eventId: 'british-colonisation-australia',
    title: 'British colonisation of Australia',
    description: '',
    dateRange: '',
    anchor: BRITISH_COLONISATION_EFFECT.destination,
  }
  return geometry.segments.map((segment) => ({
    content: () => target,
    points: segment,
    tolerancePx: ARC_TOLERANCE_PX,
    sphereLift: ARC_SPHERE_LIFT,
    mapLift: ARC_MAP_LIFT,
  }))
}

describe('GlobeTooltip pickCandidate — Melbourne hover report', () => {
  const WIDTH = 1440
  const HEIGHT = 900
  const unfold = 1 // fully-unfolded map — the simpler, fully-on-screen-at-once case to rule in or out first.
  const group = new THREE.Group()
  group.updateMatrixWorld(true)
  const camera = makeMapCamera(WIDTH, HEIGHT)

  function screenXY(point: { lat: number; lon: number }, sphereLift: number, mapLift: number): [number, number] {
    const world = new THREE.Vector3()
    const [x, y, z] = unfoldedLiftedPosition(point, unfold, GLOBE_RADIUS, sphereLift, mapLift)
    world.set(x, y, z)
    group.localToWorld(world)
    world.project(camera)
    return [(world.x * 0.5 + 0.5) * WIDTH, (-world.y * 0.5 + 0.5) * HEIGHT]
  }

  function melbourneScreenXY(): [number, number] {
    return screenXY(MELBOURNE, MARKER_SPHERE_LIFT, MARKER_MAP_LIFT)
  }

  it('sanity: Melbourne’s own city candidate wins when hovered dead-centre and nothing else is on the globe', () => {
    const [mx, my] = melbourneScreenXY()
    const candidates = [cityCandidate('melbourne-australia', 'Melbourne', MELBOURNE)]
    const hit = pickCandidate(candidates, mx, my, unfold, GLOBE_RADIUS, group, camera, WIDTH, HEIGHT)
    expect(hit?.title).toBe('Melbourne')
  })

  it('reports whether the British-colonisation arc is even a live candidate at t=100 (100 years before present)', () => {
    const timing = arrivalTimingFor(1) // Playback.baseRate = 1 (default speed) — arrivalTimingFor's own doc comment
    const presentation = arrivalPresentationAt(BRITISH_COLONISATION_EFFECT, 100, timing)
    // Not an assertion on a specific number — recorded so a failure elsewhere in this file is
    // legible against whether the arc was actually drawn at this t at all.
    console.log('arrivalPresentationAt(t=100):', presentation)
    expect(typeof presentation.arcAlpha).toBe('number')
  })

  it('Melbourne hovered dead-centre still resolves to Melbourne, not the British-colonisation arc, at every t the arc could be live', () => {
    const [mx, my] = melbourneScreenXY()
    const melbourne = cityCandidate('melbourne-australia', 'Melbourne', MELBOURNE)
    const sydney = cityCandidate('sydney-australia', 'Sydney', SYDNEY)
    const timing = arrivalTimingFor(1)
    // Sweep every t from "arc just established" (237) down to the present (0) — the arc's own
    // whole life — rather than guess a single t at which it might collide.
    const failures: { t: number; arcAlpha: number; hitTitle: string | null }[] = []
    for (let t = 237; t >= 0; t -= 1) {
      const presentation = arrivalPresentationAt(BRITISH_COLONISATION_EFFECT, t, timing)
      if (presentation.arcAlpha <= 0) continue
      const candidates = [melbourne, sydney, ...arrivalArcCandidates()]
      const hit = pickCandidate(candidates, mx, my, unfold, GLOBE_RADIUS, group, camera, WIDTH, HEIGHT)
      if (hit?.title !== 'Melbourne') failures.push({ t, arcAlpha: presentation.arcAlpha, hitTitle: hit?.title ?? null })
    }
    if (failures.length > 0) console.log('Melbourne hover hijacked at:', failures.slice(0, 10))
    expect(failures).toEqual([])
  })

  it('the arc\'s nearest point to Melbourne, and to real Sydney, in CSS pixels at this camera/viewport', () => {
    const arcCandidates = arrivalArcCandidates()
    const [mx, my] = melbourneScreenXY()
    if (arcCandidates.length === 0) {
      console.log('arc is degenerate (no segments) — geometry never registers as a hit candidate')
      return
    }
    let nearestToMelbourne = Infinity
    for (const candidate of arcCandidates) {
      for (const point of candidate.points) {
        const [sx, sy] = screenXY(point, ARC_SPHERE_LIFT, ARC_MAP_LIFT)
        const d = Math.hypot(sx - mx, sy - my)
        if (d < nearestToMelbourne) nearestToMelbourne = d
      }
    }
    console.log(`arc's nearest vertex to Melbourne: ${nearestToMelbourne.toFixed(1)}px (tolerance ${ARC_TOLERANCE_PX}px)`)
    expect(Number.isFinite(nearestToMelbourne)).toBe(true)
  })

  it("never calls a losing candidate's content builder, and calls the winner's exactly once", () => {
    const [mx, my] = melbourneScreenXY()
    let melbourneCalls = 0
    let sydneyCalls = 0
    const melbourne = cityCandidate('melbourne-australia', 'Melbourne', MELBOURNE)
    const sydney = cityCandidate('sydney-australia', 'Sydney', SYDNEY)
    const countedMelbourne: GlobeHitCandidate = {
      ...melbourne,
      content: () => {
        melbourneCalls += 1
        return melbourne.content()
      },
    }
    const countedSydney: GlobeHitCandidate = {
      ...sydney,
      content: () => {
        sydneyCalls += 1
        return sydney.content()
      },
    }

    const hit = pickCandidate([countedMelbourne, countedSydney], mx, my, unfold, GLOBE_RADIUS, group, camera, WIDTH, HEIGHT)

    expect(hit?.title).toBe('Melbourne')
    expect(melbourneCalls).toBe(1)
    expect(sydneyCalls).toBe(0)
  })
})

describe('sameHitTarget', () => {
  it('is true for two null targets', () => {
    expect(sameHitTarget(null, null)).toBe(true)
  })

  it('is true for two distinct objects sharing the same id — candidatesRef rebuilds target objects on every t change without the pointer having moved off them', () => {
    const a = cityCandidate('melbourne-australia', 'Melbourne', MELBOURNE).content()
    const b = { ...a } // a fresh object, same id, as a t-driven candidate rebuild would produce
    expect(a).not.toBe(b)
    expect(sameHitTarget(a, b)).toBe(true)
  })

  it('is false when one side is null and the other is not', () => {
    const a = cityCandidate('melbourne-australia', 'Melbourne', MELBOURNE).content()
    expect(sameHitTarget(a, null)).toBe(false)
    expect(sameHitTarget(null, a)).toBe(false)
  })

  it('is false for two different targets', () => {
    const a = cityCandidate('melbourne-australia', 'Melbourne', MELBOURNE).content()
    const b = cityCandidate('sydney-australia', 'Sydney', SYDNEY).content()
    expect(sameHitTarget(a, b)).toBe(false)
  })
})
