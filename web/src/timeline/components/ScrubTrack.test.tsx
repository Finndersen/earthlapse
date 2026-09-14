/**
 * Regression test for the QA-reported defect: every wheel gesture on the scrub track used to
 * log "Unable to preventDefault inside passive event listener invocation" because React
 * attaches `onWheel` as a passive listener. The fix (`ScrubTrack.tsx`'s `handleWheel`) is a
 * native `addEventListener('wheel', ..., { passive: false })` — these tests confirm both halves
 * of the fix: `preventDefault` actually takes effect, and the gesture still does something
 * (zooms or pans).
 */

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EARTH_FORMATION, type TimelineEvent } from '@/types/layer'

import type { TimelineCheckpoint } from '../checkpoints'
import { fisheyeScale, RESTING_FISHEYE, type FisheyeScale } from '../fisheye'
import { createSymlogScale, type TimeWindow } from '../scale'
import { ScrubTrack } from './ScrubTrack'

const FULL_DOMAIN: TimeWindow = [0, EARTH_FORMATION]
const baseScale = createSymlogScale(FULL_DOMAIN)
const scale = fisheyeScale(baseScale, RESTING_FISHEYE.lens, 1000)
const events: TimelineEvent[] = []
const checkpoints: TimelineCheckpoint[] = []

beforeEach(() => {
  // The eased zoom accumulator (`useWheelZoomAccumulator`) applies its first step via
  // requestAnimationFrame; jsdom has none, so stub it the same way every other test in this
  // package does.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0) as unknown as number)
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  // jsdom's getBoundingClientRect always reports a zero-size box; the pan/zoom math needs a
  // real pixel width to divide by, so give every element a fixed one for this file.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 1000,
    height: 48,
    top: 0,
    left: 0,
    right: 1000,
    bottom: 48,
    x: 0,
    y: 0,
    toJSON: () => undefined,
  } as DOMRect)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function renderTrack(onWindowChange = vi.fn(), overrides: Partial<ComponentProps<typeof ScrubTrack>> = {}) {
  const utils = render(
    <ScrubTrack
      t={0}
      window={FULL_DOMAIN}
      scale={scale}
      baseScale={baseScale}
      scaleKind="symlog"
      events={events}
      checkpoints={checkpoints}
      onScrub={vi.fn()}
      onWindowChange={onWindowChange}
      onFrameEvent={vi.fn()}
      onFrameCluster={vi.fn()}
      onEmptyDoubleClick={vi.fn()}
      onLensPointer={vi.fn()}
      onLensRelease={vi.fn()}
      {...overrides}
    />,
  )
  return { ...utils, onWindowChange }
}

describe('ScrubTrack wheel handling', () => {
  it('preventDefault actually takes effect on a plain vertical wheel (zoom)', () => {
    const { getByRole } = renderTrack()
    const track = getByRole('slider')
    // dispatchEvent (what fireEvent returns) is false exactly when a cancelable event was
    // actually cancelled by a handler — the direct signal that preventDefault was not silently
    // dropped by a passive listener.
    const notCancelled = fireEvent.wheel(track, { deltaY: -100, clientX: 500 })
    expect(notCancelled).toBe(false)
  })

  it('still zooms on a plain vertical wheel, via the eased accumulator', async () => {
    const { getByRole, onWindowChange } = renderTrack()
    const track = getByRole('slider')
    fireEvent.wheel(track, { deltaY: -100, clientX: 500 })
    await waitFor(() => expect(onWindowChange).toHaveBeenCalled())
    const [newWindow] = onWindowChange.mock.calls[0] as [TimeWindow]
    // deltaY < 0 zooms in — the reported window narrows.
    expect(newWindow[1] - newWindow[0]).toBeLessThan(FULL_DOMAIN[1] - FULL_DOMAIN[0])
  })

  it('preventDefault takes effect and pans immediately (not eased) on shift+wheel', () => {
    const { getByRole, onWindowChange } = renderTrack()
    const track = getByRole('slider')
    const notCancelled = fireEvent.wheel(track, { deltaY: 100, shiftKey: true, clientX: 500 })
    expect(notCancelled).toBe(false)
    expect(onWindowChange).toHaveBeenCalledTimes(1)
  })

  it('preventDefault takes effect and pans immediately on a horizontal wheel', () => {
    const { getByRole, onWindowChange } = renderTrack()
    const track = getByRole('slider')
    const notCancelled = fireEvent.wheel(track, { deltaX: 100, deltaY: 0, clientX: 500 })
    expect(notCancelled).toBe(false)
    expect(onWindowChange).toHaveBeenCalledTimes(1)
  })
})

describe('ScrubTrack fisheye integration (ADR-017)', () => {
  it('anchors a wheel-zoom on the undistorted time under the cursor when the lens is active', async () => {
    // A lens strongly off-centre so a displayed `u` and its undistorted counterpart diverge
    // enough that anchoring on the wrong one would be detectable.
    const lensScale = fisheyeScale(baseScale, { centreU: 0.2, strength: 1 }, 1000)
    const { getByRole, onWindowChange } = renderTrack(vi.fn(), { scale: lensScale })
    const track = getByRole('slider')
    const cursorU = 0.5
    const cursorT = lensScale.fromUnit(cursorU)
    // zoomWindow's own contract: the anchor's *undistorted* u stays fixed across the zoom.
    // If ScrubTrack anchored on the raw displayed `u` instead of `baseScale.toUnit(cursorT)`,
    // this would not hold.
    const expectedAnchorU = baseScale.toUnit(cursorT)
    fireEvent.wheel(track, { deltaY: -100, clientX: cursorU * 1000 })
    await waitFor(() => expect(onWindowChange).toHaveBeenCalled())
    const [newWindow] = onWindowChange.mock.calls[0] as [TimeWindow]
    expect(createSymlogScale(newWindow).toUnit(cursorT)).toBeCloseTo(expectedAnchorU, 5)
  })

  it('reports the pointer’s displayed u on hover and releases the lens on pointer leave', () => {
    const onLensPointer = vi.fn()
    const onLensRelease = vi.fn()
    const { getByRole } = renderTrack(vi.fn(), { onLensPointer, onLensRelease })
    const track = getByRole('slider')
    fireEvent.pointerMove(track, { clientX: 300, pointerId: 1 })
    expect(onLensPointer).toHaveBeenCalledWith(0.3, 1000)
    fireEvent.pointerLeave(track, { pointerId: 1 })
    expect(onLensRelease).toHaveBeenCalledTimes(1)
  })

  it('shows a snapped checkpoint label in the hover readout when hovering near its pip', () => {
    const checkpoint: TimelineCheckpoint = { id: 'cp1', t: 1e8, label: 'Test Checkpoint' }
    const { getByRole, container } = renderTrack(vi.fn(), { checkpoints: [checkpoint] })
    const track = getByRole('slider')
    const clientX = scale.toUnit(checkpoint.t) * 1000
    fireEvent.pointerMove(track, { clientX, pointerId: 1 })
    const readout = container.querySelector('[data-visible="true"]')
    expect(readout?.textContent).toContain('Test Checkpoint')
  })

  it('freezes the hover readout content through the post-leave fade, even as the lens (and `scale`) keeps decaying', () => {
    // Off-centre: at the exact midpoint distortion is a no-op fixed point, which would mask the
    // drift this test targets.
    const engagedLens = fisheyeScale(baseScale, { centreU: 0.82, strength: 1 }, 1000)
    const { getByRole, container, rerender } = renderTrack(vi.fn(), { scale: engagedLens })
    const track = getByRole('slider')
    fireEvent.pointerMove(track, { clientX: 820, pointerId: 1 })
    const before = container.querySelector('[data-visible="true"]')
    const textBefore = before?.textContent
    fireEvent.pointerLeave(track, { pointerId: 1 })

    // Simulate the parent (`Timeline`) re-rendering mid-fade with the next animation frame's
    // partially-relaxed lens — exactly what `useFisheye`'s rAF loop does after pointer-leave.
    const decayingLens = fisheyeScale(baseScale, { centreU: 0.82, strength: 0.4 }, 1000)
    rerender(
      <ScrubTrack
        t={0}
        window={FULL_DOMAIN}
        scale={decayingLens}
        baseScale={baseScale}
        scaleKind="symlog"
        events={events}
        checkpoints={checkpoints}
        onScrub={vi.fn()}
        onWindowChange={vi.fn()}
        onFrameEvent={vi.fn()}
        onFrameCluster={vi.fn()}
        onEmptyDoubleClick={vi.fn()}
        onLensPointer={vi.fn()}
        onLensRelease={vi.fn()}
      />,
    )
    const after = container.querySelector('[data-visible="false"]')
    expect(after?.textContent).toBe(textBefore)
  })
})

describe('ScrubTrack checkpoint clustering (ADR-019)', () => {
  it('renders a cluster marker instead of two colliding pips, and never renders both', () => {
    // Two checkpoints a few years apart collide well within MIN_PIP_SEPARATION_PX at this
    // track width — should merge into one cluster marker, not two pips.
    const close: TimelineCheckpoint[] = [
      { id: 'a', t: 1e8, label: 'A' },
      { id: 'b', t: 1e8 + 10, label: 'B' },
    ]
    const { container } = renderTrack(vi.fn(), { checkpoints: close })
    expect(container.querySelectorAll('[data-checkpoint-cluster]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-checkpoint-pip]')).toHaveLength(0)
  })

  it("frames the cluster's combined time span when its marker is clicked, not a plain scrub", () => {
    const close: TimelineCheckpoint[] = [
      { id: 'a', t: 1e8, label: 'A' },
      { id: 'b', t: 1e8 + 10, label: 'B' },
    ]
    const onFrameCluster = vi.fn()
    const onScrub = vi.fn()
    const { container } = renderTrack(vi.fn(), { checkpoints: close, onFrameCluster, onScrub })
    const cluster = container.querySelector('[data-checkpoint-cluster]') as Element
    fireEvent.click(cluster)
    expect(onFrameCluster).toHaveBeenCalledWith(1e8, 1e8 + 10)
    expect(onScrub).not.toHaveBeenCalled()
  })

  it("labels the cluster with the member count and its time range", () => {
    const close: TimelineCheckpoint[] = [
      { id: 'a', t: 1e8, label: 'A' },
      { id: 'b', t: 1e8 + 10, label: 'B' },
    ]
    const { container } = renderTrack(vi.fn(), { checkpoints: close })
    const cluster = container.querySelector('[data-checkpoint-cluster]') as Element
    expect(cluster.getAttribute('aria-label')).toContain('2 scenes')
  })

  it('resolves a cluster back into individual pips once the (distorted) scale gives its members room', () => {
    // A real fisheye lens over these two nearly-adjacent times would take an enormous magnitude
    // to visibly separate at this t — stand in for "a stretched region" directly, the same way
    // `checkpointLayout.test.ts`'s own fisheye-reveal regression does, rather than relying on
    // the real symlog derivative at 1e8 years to produce a many-orders-of-magnitude stretch.
    const close: TimelineCheckpoint[] = [
      { id: 'a', t: 1e8, label: 'A' },
      { id: 'b', t: 1e8 + 10, label: 'B' },
    ]
    const stretched: FisheyeScale = {
      ...baseScale,
      toUnit: (t) => (t === 1e8 ? 0.2 : t === 1e8 + 10 ? 0.8 : baseScale.toUnit(t)),
      magnificationAt: () => 1,
    }
    const { container } = renderTrack(vi.fn(), { checkpoints: close, scale: stretched })
    expect(container.querySelectorAll('[data-checkpoint-pip]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-checkpoint-cluster]')).toHaveLength(0)
  })
})

describe('ScrubTrack event declutter (ADR-019)', () => {
  function event(id: string, tMin: number, tMax: number, importance: number): TimelineEvent {
    return { id, label: id, tMin, tMax, importance, description: '', citation: '' }
  }

  it('draws a low-importance event that has room, unlike the old span-based LOD floor', () => {
    // Far from the present at full zoom-out, the old `minImportanceForSpan` floor sat near 1 —
    // only importance-1 events survived. A lone low-importance event with nothing to collide
    // with must still draw.
    const lonely = [event('minor', 2e8, 2.001e8, 0.05)]
    const { container } = renderTrack(vi.fn(), { events: lonely })
    expect(container.querySelectorAll('[title="minor"]')).toHaveLength(1)
  })

  it('drops the lower-importance event of a colliding pair, keeping the higher one', () => {
    const high = event('high', 2e8, 2.001e8, 0.9)
    const low = event('low', 2e8 + 1, 2.001e8 + 1, 0.1)
    const { container } = renderTrack(vi.fn(), { events: [high, low] })
    expect(container.querySelector('[title="high"]')).not.toBeNull()
    expect(container.querySelector('[title="low"]')).toBeNull()
  })

  it('reveals the losing event once a stretched scale gives both room to draw', () => {
    // Same rationale as the analogous checkpoint-cluster test above: stand in for "a stretched
    // region" directly rather than relying on the real symlog derivative at 2e8 years, which
    // would need an unrealistic magnification to separate two 1-year-apart bands on screen.
    const high = event('high', 2e8, 2.001e8, 0.9)
    const low = event('low', 2e8 + 1, 2.001e8 + 1, 0.1)
    const stretched: FisheyeScale = {
      ...baseScale,
      toUnit: (t) => {
        if (t === high.tMax) return 0.1
        if (t === high.tMin) return 0.15
        if (t === low.tMax) return 0.85
        if (t === low.tMin) return 0.9
        return baseScale.toUnit(t)
      },
      magnificationAt: () => 1,
    }
    const { container } = renderTrack(vi.fn(), { events: [high, low], scale: stretched })
    expect(container.querySelector('[title="high"]')).not.toBeNull()
    expect(container.querySelector('[title="low"]')).not.toBeNull()
  })
})
