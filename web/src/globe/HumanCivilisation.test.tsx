import { describe, expect, it } from 'vitest'

import type { FeatureData } from '@/types/layer'

import { cityRadiusPx, type CityAtTime } from './cities'
import { cityLabelVisibility, cityTarget } from './HumanCivilisation'

// Same conventions arcs.test.ts's own `sphereMarkerVisibility` suite uses, since
// `cityLabelVisibility` wraps that exact function for its limb half.
const CAMERA_DISTANCE = 3.6
const RADIUS = 1
const ON_SCREEN_CENTER: [number, number, number] = [0, 0, 0.5]

describe('cityLabelVisibility', () => {
  const cameraPosition: [number, number, number] = [0, 0, CAMERA_DISTANCE]

  it('is 0 off-screen (outside the NDC x/y bounds), even for a marker facing the camera directly', () => {
    const worldPosition: [number, number, number] = [0, 0, 1] // dead centre, would otherwise be fully visible
    expect(cityLabelVisibility(worldPosition, cameraPosition, RADIUS, 0, [1.4, 0, 0.5])).toBe(0)
    expect(cityLabelVisibility(worldPosition, cameraPosition, RADIUS, 0, [0, -1.2, 0.5])).toBe(0)
  })

  it('is 0 for a marker behind the camera (ndc.z > 1), regardless of x/y', () => {
    const worldPosition: [number, number, number] = [0, 0, 1]
    expect(cityLabelVisibility(worldPosition, cameraPosition, RADIUS, 0, [0, 0, 1.5])).toBe(0)
  })

  it('never applies the limb test once unfolded past the midpoint (map mode has no back face) — on-screen is always fully visible there', () => {
    // A world position facing directly AWAY from the camera would fail the sphere limb test, but
    // in map mode (unfold >= 0.5) that test is skipped entirely, mirroring GlobeTooltip.tsx's own
    // `projectAnchor` shortcut.
    const farSideWorldPosition: [number, number, number] = [0, 0, -1]
    expect(cityLabelVisibility(farSideWorldPosition, cameraPosition, RADIUS, 0.5, ON_SCREEN_CENTER)).toBe(1)
    expect(cityLabelVisibility(farSideWorldPosition, cameraPosition, RADIUS, 1, ON_SCREEN_CENTER)).toBe(1)
  })

  it('is fully visible on-screen, in sphere mode, for a marker facing the camera directly', () => {
    const worldPosition: [number, number, number] = [0, 0, 1]
    expect(cityLabelVisibility(worldPosition, cameraPosition, RADIUS, 0, ON_SCREEN_CENTER)).toBe(1)
  })

  it('is 0 on-screen, in sphere mode, for a marker on the far side of the globe, directly away from the camera (BUG: a label must not float over empty space with no dot under it)', () => {
    const farSideWorldPosition: [number, number, number] = [0, 0, -1]
    expect(cityLabelVisibility(farSideWorldPosition, cameraPosition, RADIUS, 0, ON_SCREEN_CENTER)).toBe(0)
  })

  it('the SAME city, rotated into view, becomes visible again — a city founded on the far side gets its label the moment it rotates front-and-centre, never remembered/replayed later', () => {
    // Before rotation: the marker's own world position faces away from the camera.
    const beforeRotation: [number, number, number] = [0, 0, -1]
    expect(cityLabelVisibility(beforeRotation, cameraPosition, RADIUS, 0, ON_SCREEN_CENTER)).toBe(0)

    // After the globe has rotated the same physical point front-and-centre, its world position
    // now faces the camera directly (this is exactly what `group.localToWorld` produces frame to
    // frame as the rotating group's own orientation changes — the component re-derives this every
    // frame via `useFrame`, never caching "was visible once").
    const afterRotation: [number, number, number] = [0, 0, 1]
    expect(cityLabelVisibility(afterRotation, cameraPosition, RADIUS, 0, ON_SCREEN_CENTER)).toBe(1)
  })

  it('fades smoothly through the same intermediate band sphereMarkerVisibility itself fades through, in sphere mode — matching the dot’s own limb fade rather than popping', () => {
    const thresholdCos = RADIUS / CAMERA_DISTANCE
    const horizonAngle = Math.acos(thresholdCos)
    const horizonWorldPosition: [number, number, number] = [Math.sin(horizonAngle), 0, Math.cos(horizonAngle)]
    const visibility = cityLabelVisibility(horizonWorldPosition, cameraPosition, RADIUS, 0, ON_SCREEN_CENTER)
    expect(visibility).toBeGreaterThan(0)
    expect(visibility).toBeLessThan(1)
  })
})

describe('cityTarget', () => {
  function cityAt(feature: FeatureData, population: number): CityAtTime {
    return { feature, population, radiusPx: cityRadiusPx(population), trailingFade: 1 }
  }

  // Real published shape: newest reading t=115 (1910 CE), well before the present — still drawn
  // via CITY_TRAILING_GRACE_T (Sana'a is Yemen's capital and obviously still exists).
  const SANAA: FeatureData = {
    id: 'sanaa-yemen',
    name: "Sana'a",
    country: 'Yemen',
    lat: 15.35472,
    lon: 44.20667,
    certainty: 'high',
    estimates: [
      { t: 115, population: 18_000 },
      { t: 522, population: 5_000 },
    ],
  }

  it("renders a city's date range as record data, not as a lifespan (does not read as a start/end of existence)", () => {
    const target = cityTarget(cityAt(SANAA, 18_000), 81)
    expect(target.dateRange).not.toMatch(/^Recorded /)
    expect(target.dateRange).toContain('Records')
    expect(target.dateRange).toContain('522 years ago')
    expect(target.dateRange).toContain('115 years ago')
  })

  it('never invents an end date beyond the newest attested reading, even while still being drawn past it (grace window)', () => {
    // t=81 is within CITY_TRAILING_GRACE_T (200) of Sana'a's newest reading (115), so it's still
    // drawn — but the tooltip must still describe the same [522, 115] record span, not a range
    // stretched or reinterpreted to reach t=81.
    const target = cityTarget(cityAt(SANAA, 18_000), 81)
    expect(target.dateRange).toBe('Records: 522 years ago – 115 years ago')
  })
})
