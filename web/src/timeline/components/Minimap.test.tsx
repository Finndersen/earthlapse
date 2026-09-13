import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EARTH_FORMATION } from '@/types/layer'

import type { TimelineCheckpoint } from '../checkpoints'
import { minimapBracket } from '../minimapLayout'
import type { TimeWindow } from '../scale'
import { MIN_SPAN_YEARS } from '../zoom'
import { Minimap } from './Minimap'

const TRACK_WIDTH = 800

// jsdom lays out nothing, so every element's real getBoundingClientRect is a zero rect — the
// component's own pixel math (classifyZone, pixelToT) reads it directly rather than going
// through the ResizeObserver-backed `trackWidthPx` state, so this must be mocked for any of
// that math to be exercised at all. jsdom also has `PointerEvent` (fireEvent.pointerDown/move
// rely on it) but not `Element#setPointerCapture` — polyfilled as a no-op below, matching the
// common RTL workaround for pointer-capture-using components.
beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: TRACK_WIDTH,
    bottom: 20,
    width: TRACK_WIDTH,
    height: 20,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderMinimap(window: TimeWindow, onWindowChange = vi.fn(), animateWindowTo = vi.fn()) {
  render(<Minimap t={window[0]} window={window} onWindowChange={onWindowChange} animateWindowTo={animateWindowTo} />)
  const track = screen.getByRole('slider', { name: /overview/i })
  return { track, onWindowChange, animateWindowTo }
}

/** A window with a generous pixel-width bracket at `TRACK_WIDTH`, comfortably clear of both
 *  `EARTH_FORMATION`'s edges and the bracket's own edge-handles, so a grab anywhere near its
 *  centre unambiguously classifies as 'pan' rather than a resize handle or an edge clamp. */
const MID_WINDOW: TimeWindow = [1e6, 5e6]

describe('<Minimap> pointer drag', () => {
  it('pans toward the present (both bounds decrease) when the bracket is dragged right', () => {
    const { track, onWindowChange } = renderMinimap(MID_WINDOW)
    const { leftPx, widthPx } = minimapBracket(MID_WINDOW, TRACK_WIDTH)
    const grabX = leftPx + widthPx / 2

    fireEvent.pointerDown(track, { clientX: grabX, pointerId: 1 })
    fireEvent.pointerMove(track, { clientX: grabX + 40, pointerId: 1 })

    expect(onWindowChange).toHaveBeenCalled()
    const result = onWindowChange.mock.calls.at(-1)![0] as TimeWindow
    const [newest, oldest] = result
    // Regression: dragging right must pan toward the present (smaller t), not away from it.
    expect(newest).toBeLessThan(MID_WINDOW[0])
    expect(oldest).toBeLessThan(MID_WINDOW[1])
    // The bracket's rendered pixel width — not the raw-year span — stays constant across a pan
    // (defect a: the strip is symlog, a nonlinear warp, so a fixed raw-year span does not mean
    // a fixed pixel width; see the dedicated "defect a" tests below for the full story).
    expect(minimapBracket(result, TRACK_WIDTH).widthPx).toBeCloseTo(widthPx, 3)
  })

  it('pans toward the past (both bounds increase) when the bracket is dragged left', () => {
    const { track, onWindowChange } = renderMinimap(MID_WINDOW)
    const { leftPx, widthPx } = minimapBracket(MID_WINDOW, TRACK_WIDTH)
    const grabX = leftPx + widthPx / 2

    fireEvent.pointerDown(track, { clientX: grabX, pointerId: 1 })
    fireEvent.pointerMove(track, { clientX: grabX - 40, pointerId: 1 })

    const [newest, oldest] = onWindowChange.mock.calls.at(-1)![0] as TimeWindow
    expect(newest).toBeGreaterThan(MID_WINDOW[0])
    expect(oldest).toBeGreaterThan(MID_WINDOW[1])
  })

  // Regression (defect a): panning used to shift both raw-year bounds by a fixed amount,
  // which — because the minimap's strip is symlog, a nonlinear warp — keeps the raw-year span
  // constant but does NOT keep the bracket's rendered pixel width constant, and does not track
  // the cursor 1:1. The fix (`panBracket`) works in the minimap's own full-domain warped
  // `u`-space instead, so it is the *pixel* width and position that stay exact, not the raw
  // years. These two tests assert the property that actually matters to the person dragging it.
  it('keeps the bracket pixel width exactly constant across a pan drag (defect a)', () => {
    const { track, onWindowChange } = renderMinimap(MID_WINDOW)
    const { leftPx, widthPx } = minimapBracket(MID_WINDOW, TRACK_WIDTH)
    const grabX = leftPx + widthPx / 2

    fireEvent.pointerDown(track, { clientX: grabX, pointerId: 1 })
    for (const dx of [5, 12, 30, 31]) {
      fireEvent.pointerMove(track, { clientX: grabX + dx, pointerId: 1 })
    }

    const result = onWindowChange.mock.calls.at(-1)![0] as TimeWindow
    const { widthPx: resultWidthPx } = minimapBracket(result, TRACK_WIDTH)
    expect(resultWidthPx).toBeCloseTo(widthPx, 3)
  })

  it('tracks the cursor exactly (1:1 in pixels) across a pan drag (defect a)', () => {
    const { track, onWindowChange } = renderMinimap(MID_WINDOW)
    const { leftPx, widthPx } = minimapBracket(MID_WINDOW, TRACK_WIDTH)
    const grabX = leftPx + widthPx / 2
    const dx = 78

    fireEvent.pointerDown(track, { clientX: grabX, pointerId: 1 })
    fireEvent.pointerMove(track, { clientX: grabX + dx, pointerId: 1 })

    const result = onWindowChange.mock.calls.at(-1)![0] as TimeWindow
    const { leftPx: resultLeftPx } = minimapBracket(result, TRACK_WIDTH)
    expect(resultLeftPx - leftPx).toBeCloseTo(dx, 3)
  })

  it('resizing the left edge changes only the oldest bound', () => {
    const { track, onWindowChange } = renderMinimap(MID_WINDOW)
    const { leftPx } = minimapBracket(MID_WINDOW, TRACK_WIDTH)

    fireEvent.pointerDown(track, { clientX: leftPx, pointerId: 1 })
    fireEvent.pointerMove(track, { clientX: leftPx + 20, pointerId: 1 })

    const [newest, oldest] = onWindowChange.mock.calls.at(-1)![0] as TimeWindow
    expect(newest).toBe(MID_WINDOW[0])
    expect(oldest).not.toBe(MID_WINDOW[1])
  })

  it('resizing the right edge changes only the newest bound', () => {
    const { track, onWindowChange } = renderMinimap(MID_WINDOW)
    const { leftPx, widthPx } = minimapBracket(MID_WINDOW, TRACK_WIDTH)
    const rightEdge = leftPx + widthPx

    fireEvent.pointerDown(track, { clientX: rightEdge, pointerId: 1 })
    fireEvent.pointerMove(track, { clientX: rightEdge - 20, pointerId: 1 })

    const [newest, oldest] = onWindowChange.mock.calls.at(-1)![0] as TimeWindow
    expect(oldest).toBe(MID_WINDOW[1])
    expect(newest).not.toBe(MID_WINDOW[0])
  })

  // Regression (defect b): dragging an edge handle far past the opposite edge used to collapse
  // the window to MIN_SPAN_YEARS and get permanently stuck there.
  it('never inverts or collapses-and-sticks when the left edge is dragged past the right edge (defect b)', () => {
    const { track, onWindowChange } = renderMinimap(MID_WINDOW)
    const { leftPx, widthPx } = minimapBracket(MID_WINDOW, TRACK_WIDTH)
    const rightEdge = leftPx + widthPx

    fireEvent.pointerDown(track, { clientX: leftPx, pointerId: 1 })
    fireEvent.pointerMove(track, { clientX: rightEdge + 60, pointerId: 1 })
    const overshoot = onWindowChange.mock.calls.at(-1)![0] as TimeWindow
    expect(overshoot[0]).toBeLessThanOrEqual(overshoot[1])
    expect(overshoot[1] - overshoot[0]).toBeGreaterThan(MIN_SPAN_YEARS)

    // Still responsive to further dragging, not stuck at a fixed minimum span.
    fireEvent.pointerMove(track, { clientX: rightEdge + 120, pointerId: 1 })
    const further = onWindowChange.mock.calls.at(-1)![0] as TimeWindow
    expect(further[1] - further[0]).toBeGreaterThan(overshoot[1] - overshoot[0])
  })
})

describe('<Minimap> brush-select at full zoom-out (defect c)', () => {
  it('draws a fresh window from the pointer-down position when the bracket spans the whole strip', () => {
    const FULL: TimeWindow = [0, EARTH_FORMATION]
    const { track, onWindowChange } = renderMinimap(FULL)

    const startX = 200
    fireEvent.pointerDown(track, { clientX: startX, pointerId: 1 })
    fireEvent.pointerMove(track, { clientX: startX + 150, pointerId: 1 })

    expect(onWindowChange).toHaveBeenCalled()
    const result = onWindowChange.mock.calls.at(-1)![0] as TimeWindow
    // A genuinely new (narrower) window, not a no-op pan of an already-full bracket.
    expect(result[1] - result[0]).toBeLessThan(EARTH_FORMATION)
  })

  it('a plain click (no drag) at full zoom-out does not recentre or otherwise change the window', () => {
    const FULL: TimeWindow = [0, EARTH_FORMATION]
    const { track, onWindowChange, animateWindowTo } = renderMinimap(FULL)

    fireEvent.click(track, { clientX: 300, detail: 1 })

    expect(onWindowChange).not.toHaveBeenCalled()
    expect(animateWindowTo).not.toHaveBeenCalled()
  })
})

describe('<Minimap> click / double-click', () => {
  it('recentres (via animateWindowTo) on a click outside the bracket', () => {
    const { track, animateWindowTo } = renderMinimap(MID_WINDOW)
    const { leftPx, widthPx } = minimapBracket(MID_WINDOW, TRACK_WIDTH)
    const outsideX = leftPx + widthPx + 100

    fireEvent.click(track, { clientX: outsideX, detail: 1 })

    expect(animateWindowTo).toHaveBeenCalledTimes(1)
    const [newest, oldest] = animateWindowTo.mock.calls[0]![0] as TimeWindow
    expect(oldest - newest).toBeCloseTo(MID_WINDOW[1] - MID_WINDOW[0], 0)
  })

  it('does not recentre on a click inside the bracket (that is a drag/no-op, not a recentre)', () => {
    const { track, animateWindowTo } = renderMinimap(MID_WINDOW)
    const { leftPx, widthPx } = minimapBracket(MID_WINDOW, TRACK_WIDTH)
    const insideX = leftPx + widthPx / 2

    fireEvent.click(track, { clientX: insideX, detail: 1 })

    expect(animateWindowTo).not.toHaveBeenCalled()
  })

  it('fits the full domain on double-click', () => {
    const { track, animateWindowTo } = renderMinimap(MID_WINDOW)

    fireEvent.doubleClick(track)

    expect(animateWindowTo).toHaveBeenCalledWith([0, EARTH_FORMATION])
  })
})

describe('<Minimap> checkpoints', () => {
  it('renders a titled tick for every checkpoint, regardless of the visible window', () => {
    const checkpoints: TimelineCheckpoint[] = [
      { id: 'pleistocene-steppe', t: 20000, label: 'Pleistocene steppe' },
      { id: 'modern-city', t: 0, label: 'Modern city' },
    ]
    render(<Minimap t={MID_WINDOW[0]} window={MID_WINDOW} checkpoints={checkpoints} onWindowChange={vi.fn()} animateWindowTo={vi.fn()} />)
    expect(screen.getByTitle('Pleistocene steppe')).toBeTruthy()
    expect(screen.getByTitle('Modern city')).toBeTruthy()
  })

  it('renders no checkpoint ticks when none are passed', () => {
    render(<Minimap t={MID_WINDOW[0]} window={MID_WINDOW} onWindowChange={vi.fn()} animateWindowTo={vi.fn()} />)
    expect(screen.queryByTitle('Pleistocene steppe')).toBeNull()
  })
})
