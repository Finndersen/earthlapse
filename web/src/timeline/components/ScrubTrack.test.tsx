/**
 * Regression test for the QA-reported defect: every wheel gesture on the scrub track used to
 * log "Unable to preventDefault inside passive event listener invocation" because React
 * attaches `onWheel` as a passive listener. The fix (`ScrubTrack.tsx`'s `handleWheel`) is a
 * native `addEventListener('wheel', ..., { passive: false })` — these tests confirm both halves
 * of the fix: `preventDefault` actually takes effect, and the gesture still does something
 * (zooms or pans).
 */

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EARTH_FORMATION, type TimelineEvent } from '@/types/layer'

import type { TimelineCheckpoint } from '../checkpoints'
import { createSymlogScale, type TimeWindow } from '../scale'
import { ScrubTrack } from './ScrubTrack'

const FULL_DOMAIN: TimeWindow = [0, EARTH_FORMATION]
const scale = createSymlogScale(FULL_DOMAIN)
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

function renderTrack(onWindowChange = vi.fn()) {
  const utils = render(
    <ScrubTrack
      t={0}
      window={FULL_DOMAIN}
      scale={scale}
      scaleKind="symlog"
      events={events}
      checkpoints={checkpoints}
      onScrub={vi.fn()}
      onWindowChange={onWindowChange}
      onFrameEvent={vi.fn()}
      onEmptyDoubleClick={vi.fn()}
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
