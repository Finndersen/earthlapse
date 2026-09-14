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
import { fisheyeScale, RESTING_FISHEYE } from '../fisheye'
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
        onEmptyDoubleClick={vi.fn()}
        onLensPointer={vi.fn()}
        onLensRelease={vi.fn()}
      />,
    )
    const after = container.querySelector('[data-visible="false"]')
    expect(after?.textContent).toBe(textBefore)
  })
})
