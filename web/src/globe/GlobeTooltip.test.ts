// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { arrivalPresentationAt, arrivalTimingFor, buildArrivalArcGeometry } from './arcs'
import {
  bindGlobeHitTest,
  GlobeTooltipCard,
  pickCandidate,
  sameHitTarget,
  type GlobeHitCandidate,
  type GlobeHitTarget,
} from './GlobeTooltip'
import { ARC_MAP_LIFT, ARC_SPHERE_LIFT, MARKER_MAP_LIFT, MARKER_SPHERE_LIFT } from './humanStyle'
import { EQUAL_EARTH_HALF_HEIGHT, EQUAL_EARTH_HALF_WIDTH, unfoldedLiftedPosition } from './projection'
import type { ArrivalGlobeEffect } from '@/types/layer'

/**
 * Hit-picking against real geometry: the British-colonisation arc ends 2 km from Sydney and
 * ~713 km from Melbourne, and must never steal a hover centred on Melbourne's dot.
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

// Mirrors HumanCivilisation.tsx's (unexported) hit tolerances.
const ARC_TOLERANCE_PX = 7
const MARKER_TOLERANCE_PX = 11

const GLOBE_RADIUS = 1 // Globe.tsx's own GLOBE_RADIUS
// Globe.tsx's map-mode fit: fov 40, the Equal Earth extents plus a 3% margin fill the viewport.
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

describe('pickCandidate on the unfolded map', () => {
  const WIDTH = 1440
  const HEIGHT = 900
  const unfold = 1
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

  it('resolves a hover on Melbourne to Melbourne at every t the arc is drawn', () => {
    const [mx, my] = melbourneScreenXY()
    const melbourne = cityCandidate('melbourne-australia', 'Melbourne', MELBOURNE)
    const sydney = cityCandidate('sydney-australia', 'Sydney', SYDNEY)
    const timing = arrivalTimingFor(1)
    const failures: { t: number; arcAlpha: number; hitTitle: string | null }[] = []
    let liveFrames = 0
    for (let t = 237; t >= 0; t -= 1) {
      const presentation = arrivalPresentationAt(BRITISH_COLONISATION_EFFECT, t, timing)
      if (presentation.arcAlpha <= 0) continue
      liveFrames += 1
      const candidates = [melbourne, sydney, ...arrivalArcCandidates()]
      const hit = pickCandidate(candidates, mx, my, unfold, GLOBE_RADIUS, group, camera, WIDTH, HEIGHT)
      if (hit?.title !== 'Melbourne') failures.push({ t, arcAlpha: presentation.arcAlpha, hitTitle: hit?.title ?? null })
    }
    expect(liveFrames).toBeGreaterThan(0)
    expect(failures).toEqual([])
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
  it('compares targets by id, treating null as its own value', () => {
    const a = cityCandidate('melbourne-australia', 'Melbourne', MELBOURNE).content()
    expect(sameHitTarget(null, null)).toBe(true)
    expect(sameHitTarget(a, { ...a })).toBe(true)
    expect(sameHitTarget(a, null)).toBe(false)
    expect(sameHitTarget(a, cityCandidate('sydney-australia', 'Sydney', SYDNEY).content())).toBe(false)
  })
})

describe('bindGlobeHitTest', () => {
  const ARRIVAL: GlobeHitTarget = {
    kind: 'arrival',
    id: 'arrival:yamnaya-steppe-migration',
    eventId: 'yamnaya-steppe-migration',
    title: 'Yamnaya steppe migration',
    description: 'A long description the tooltip clamps to three lines.',
    dateRange: '',
    anchor: { lat: 48, lon: 20 },
  }

  function pointer(type: string, pointerType: 'mouse' | 'touch', x: number): Event {
    const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: 0 })
    Object.defineProperty(event, 'pointerType', { value: pointerType })
    return event
  }

  function setup(hitAt: (x: number) => GlobeHitTarget | null, activate: ((eventId: string) => void) | null, touchTaps = true) {
    const canvas = document.createElement('canvas')
    const parent = document.createElement('div')
    parent.appendChild(canvas)
    const shown: { target: GlobeHitTarget | null; viaTouch: boolean }[] = []
    const parentClicks: Event[] = []
    const touchHitRef = { current: false }
    parent.addEventListener('click', (event) => parentClicks.push(event))
    const handle = bindGlobeHitTest(canvas, {
      resolve: (x) => hitAt(x),
      onChange: (target, viaTouch) => shown.push({ target, viaTouch }),
      touchHitRef,
      touchTapsRef: { current: touchTaps },
      activateRef: { current: activate },
    })
    const tap = (pointerType: 'mouse' | 'touch', x: number, releaseX = x): void => {
      canvas.dispatchEvent(pointer('pointerdown', pointerType, x))
      canvas.dispatchEvent(pointer('pointerup', pointerType, releaseX))
      canvas.dispatchEvent(pointer('click', pointerType, releaseX))
    }
    return { canvas, shown, parentClicks, handle, tap, touchHitRef }
  }

  it('opens an arrival on a mouse click, but not on a drag or while no handler is bound, as on the minimised orb', () => {
    const activate = vi.fn()
    const bound = setup(() => ARRIVAL, activate)
    bound.tap('mouse', 10)
    expect(activate).toHaveBeenCalledExactlyOnceWith('yamnaya-steppe-migration')
    expect(bound.parentClicks).toHaveLength(0)
    bound.tap('mouse', 10, 40)
    expect(activate).toHaveBeenCalledTimes(1)
    const minimised = setup(() => ARRIVAL, null)
    minimised.tap('mouse', 10)
    expect(minimised.parentClicks).toHaveLength(1)
  })

  it('pins nothing on a touch tap while taps are off, as on the minimised orb, leaving the tap to expand it', () => {
    const { canvas, tap, shown, parentClicks, touchHitRef } = setup(() => ARRIVAL, null, false)
    canvas.dispatchEvent(pointer('pointerdown', 'touch', 10))
    expect(touchHitRef.current).toBe(false)
    tap('touch', 10)
    expect(shown).toHaveLength(0)
    expect(parentClicks).toHaveLength(1)
    canvas.dispatchEvent(pointer('pointermove', 'mouse', 10))
    expect(shown.at(-1)).toEqual({ target: ARRIVAL, viaTouch: false })
  })

  it('shows the tooltip on a first touch tap and opens the event, closing it, on a second tap or from the tooltip', () => {
    const activate = vi.fn()
    const { tap, shown, handle } = setup(() => ARRIVAL, activate)
    tap('touch', 10)
    expect(shown.at(-1)).toEqual({ target: ARRIVAL, viaTouch: true })
    expect(activate).not.toHaveBeenCalled()
    tap('touch', 12)
    expect(activate).toHaveBeenCalledExactlyOnceWith('yamnaya-steppe-migration')
    expect(shown.at(-1)?.target).toBeNull()

    tap('touch', 10)
    handle.activateShown()
    expect(activate).toHaveBeenCalledTimes(2)
    expect(shown.at(-1)?.target).toBeNull()

    tap('touch', 10)
    handle.dismiss()
    expect(shown.at(-1)?.target).toBeNull()
    expect(activate).toHaveBeenCalledTimes(2)
  })
})

describe('GlobeTooltipCard', () => {
  afterEach(cleanup)

  const CITY: GlobeHitTarget = {
    kind: 'city',
    id: 'city:rome',
    eventId: null,
    title: 'Rome',
    description: '',
    dateRange: '',
    anchor: { lat: 41.9, lon: 12.5 },
  }

  it('once pinned, opens the detail from its body and closes from its ×, with no press reaching the globe underneath', () => {
    const onOpen = vi.fn()
    const onDismiss = vi.fn()
    const underneath = vi.fn()
    render(
      createElement('div', { onClick: underneath, onPointerDown: underneath }, createElement(GlobeTooltipCard, { target: CITY, hint: null, pinned: true, onOpen, onDismiss })),
    )
    const body = screen.getByRole('button', { name: 'Open details: Rome' })
    const close = screen.getByRole('button', { name: 'Close preview' })
    // The pinning tap's own click, pressed on the canvas, lands on the card: ignored.
    fireEvent.click(body, { detail: 1 })
    expect(onOpen).not.toHaveBeenCalled()
    fireEvent.pointerDown(body)
    fireEvent.click(body, { detail: 1 })
    expect(onOpen).toHaveBeenCalledOnce()
    fireEvent.pointerDown(close)
    fireEvent.click(close, { detail: 1 })
    expect(onDismiss).toHaveBeenCalledOnce()
    fireEvent.click(close, { detail: 0 })
    expect(onDismiss).toHaveBeenCalledTimes(2)
    expect(underneath).not.toHaveBeenCalled()
    cleanup()

    render(createElement(GlobeTooltipCard, { target: CITY, hint: null, pinned: false, onOpen, onDismiss }))
    expect(screen.queryByRole('button')).toBeNull()
  })
})
