import { cleanup, fireEvent, render } from '@testing-library/react'
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
  // jsdom's getBoundingClientRect always reports a zero-size box; the declutter/hover math
  // needs a real pixel width to divide by, so give every element a fixed one for this file.
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
  vi.restoreAllMocks()
})

function renderTrack(overrides: Partial<ComponentProps<typeof ScrubTrack>> = {}) {
  return render(
    <ScrubTrack
      t={0}
      window={FULL_DOMAIN}
      scale={scale}
      events={events}
      checkpoints={checkpoints}
      onScrub={vi.fn()}
      onOpenCluster={vi.fn()}
      onLensPointer={vi.fn()}
      onLensRelease={vi.fn()}
      {...overrides}
    />,
  )
}

describe('ScrubTrack fisheye integration (ADR-017)', () => {
  it('reports the pointer’s displayed u on hover and releases the lens on pointer leave', () => {
    const onLensPointer = vi.fn()
    const onLensRelease = vi.fn()
    const { getByRole } = renderTrack({ onLensPointer, onLensRelease })
    const track = getByRole('slider')
    fireEvent.pointerMove(track, { clientX: 300, pointerId: 1 })
    expect(onLensPointer).toHaveBeenCalledWith(0.3, 1000)
    fireEvent.pointerLeave(track, { pointerId: 1 })
    expect(onLensRelease).toHaveBeenCalledTimes(1)
  })

  it('shows a snapped checkpoint label in the hover readout when hovering near its pip', () => {
    const checkpoint: TimelineCheckpoint = { id: 'cp1', t: 1e8, label: 'Test Checkpoint' }
    const { getByRole, container } = renderTrack({ checkpoints: [checkpoint] })
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
    const { getByRole, container, rerender } = renderTrack({ scale: engagedLens })
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
        events={events}
        checkpoints={checkpoints}
        onScrub={vi.fn()}
        onOpenCluster={vi.fn()}
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
    const { container } = renderTrack({ checkpoints: close })
    expect(container.querySelectorAll('[data-checkpoint-cluster]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-checkpoint-pip]')).toHaveLength(0)
  })

  it("opens the cluster's member list when its marker is clicked, not a plain scrub", () => {
    const close: TimelineCheckpoint[] = [
      { id: 'a', t: 1e8, label: 'A' },
      { id: 'b', t: 1e8 + 10, label: 'B' },
    ]
    const onOpenCluster = vi.fn()
    const onScrub = vi.fn()
    const { container } = renderTrack({ checkpoints: close, onOpenCluster, onScrub })
    const cluster = container.querySelector('[data-checkpoint-cluster]') as Element
    fireEvent.click(cluster)
    // Screen order (oldest to newest, per the package's left-to-right orientation): 'b' has the
    // larger t (further into the past) and so sits left of 'a'.
    expect(onOpenCluster).toHaveBeenCalledWith([close[1], close[0]])
    expect(onScrub).not.toHaveBeenCalled()
  })

  it("labels the cluster with the member count and its time range", () => {
    const close: TimelineCheckpoint[] = [
      { id: 'a', t: 1e8, label: 'A' },
      { id: 'b', t: 1e8 + 10, label: 'B' },
    ]
    const { container } = renderTrack({ checkpoints: close })
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
    const { container } = renderTrack({ checkpoints: close, scale: stretched })
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
    const { container } = renderTrack({ events: lonely })
    expect(container.querySelectorAll('[title="minor"]')).toHaveLength(1)
  })

  it('drops the lower-importance event of a colliding pair, keeping the higher one', () => {
    const high = event('high', 2e8, 2.001e8, 0.9)
    const low = event('low', 2e8 + 1, 2.001e8 + 1, 0.1)
    const { container } = renderTrack({ events: [high, low] })
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
    const { container } = renderTrack({ events: [high, low], scale: stretched })
    expect(container.querySelector('[title="high"]')).not.toBeNull()
    expect(container.querySelector('[title="low"]')).not.toBeNull()
  })
})

describe('ScrubTrack hover readout precision (ADR-021)', () => {
  it('reads more decimal digits once the local pixel budget is finer than formatGeoTime already shows', () => {
    // A hand-rolled scale where 1 displayed px near u=0.5 spans a fraction of a year — the kind
    // of resolution only a fully-resolved fisheye gap produces on the real symlog track (see
    // fisheye.test.ts's own K-Pg round-trip tests) — stood in for directly, the same way the
    // declutter/clustering "stretched scale" tests above do.
    const microScale: FisheyeScale = {
      ...baseScale,
      toUnit: () => 0.5,
      fromUnit: (u) => 66_042_999.99 + (u - 0.5) * 0.002,
      magnificationAt: () => 1,
    }
    const { getByRole, container } = renderTrack({ scale: microScale })
    const track = getByRole('slider')
    fireEvent.pointerMove(track, { clientX: 500, pointerId: 1 })
    const readout = container.querySelector('[data-visible="true"] .time') ?? container.querySelector('[data-visible="true"]')
    expect(readout?.textContent).toMatch(/66,042,999\.\d+ years ago/)
  })
})

describe('ScrubTrack hover readout edge anchoring and touch handoff (polish)', () => {
  it('anchors the hover readout to the track edge well before the old, pip-preview-sized threshold would', () => {
    // 100px from the left edge of a 1000px track: inside the readout's own (wider)
    // `HOVER_READOUT_HALF_WIDTH_PX` threshold but outside the narrower one a lone pip preview
    // uses — a long snapped label at this position used to still risk clipping the viewport.
    const { getByRole, container } = renderTrack()
    const track = getByRole('slider')
    fireEvent.pointerMove(track, { clientX: 100, pointerId: 1, pointerType: 'mouse' })
    const readout = container.querySelector('[data-visible="true"]')
    expect(readout?.className).toContain('previewStart')
  })

  it('anchors the hover readout to the right track edge symmetrically', () => {
    const { getByRole, container } = renderTrack()
    const track = getByRole('slider')
    fireEvent.pointerMove(track, { clientX: 900, pointerId: 1, pointerType: 'mouse' })
    const readout = container.querySelector('[data-visible="true"]')
    expect(readout?.className).toContain('previewEnd')
  })

  it('marks the track touch-active while a touch/pen pointer is pressed, so its own hover readout can step aside for the magnifier', () => {
    const { getByRole } = renderTrack()
    const track = getByRole('slider')
    expect(track.getAttribute('data-touch-active')).toBe('false')
    fireEvent.pointerDown(track, { clientX: 400, clientY: 300, pointerId: 5, pointerType: 'touch' })
    expect(track.getAttribute('data-touch-active')).toBe('true')
    fireEvent.pointerUp(track, { pointerId: 5, pointerType: 'touch' })
    expect(track.getAttribute('data-touch-active')).toBe('false')
  })

  it('never marks the track touch-active for a mouse hover', () => {
    const { getByRole } = renderTrack()
    const track = getByRole('slider')
    fireEvent.pointerMove(track, { clientX: 400, clientY: 300, pointerId: 1, pointerType: 'mouse' })
    expect(track.getAttribute('data-touch-active')).toBe('false')
  })
})

describe('ScrubTrack cluster popover (ADR-021)', () => {
  const close: TimelineCheckpoint[] = [
    { id: 'a', t: 1e8, label: 'Scene A' },
    { id: 'b', t: 1e8 + 10, label: 'Scene B' },
  ]

  it('opens a member-list popover naming both scenes when the cluster is clicked', () => {
    const { container, getByRole } = renderTrack({ checkpoints: close })
    const cluster = container.querySelector('[data-checkpoint-cluster]') as Element
    fireEvent.click(cluster)
    const popover = getByRole('dialog')
    expect(popover.textContent).toContain('Scene A')
    expect(popover.textContent).toContain('Scene B')
  })

  it('scrubs to the chosen member and closes on selection', () => {
    const onScrub = vi.fn()
    const { container, getByText, queryByRole } = renderTrack({ checkpoints: close, onScrub })
    const cluster = container.querySelector('[data-checkpoint-cluster]') as Element
    fireEvent.click(cluster)
    fireEvent.click(getByText('Scene B'))
    expect(onScrub).toHaveBeenCalledWith(close[1]!.t)
    expect(queryByRole('dialog')).toBeNull()
  })

  it('closes on Escape without scrubbing', () => {
    const onScrub = vi.fn()
    const { container, getByRole, queryByRole } = renderTrack({ checkpoints: close, onScrub })
    const cluster = container.querySelector('[data-checkpoint-cluster]') as Element
    fireEvent.click(cluster)
    fireEvent.keyDown(getByRole('dialog'), { key: 'Escape' })
    expect(queryByRole('dialog')).toBeNull()
    expect(onScrub).not.toHaveBeenCalled()
  })

  it('closes when the track is pressed elsewhere, and swallows that press rather than also scrubbing', () => {
    const onScrub = vi.fn()
    const { container, getByRole, queryByRole } = renderTrack({ checkpoints: close, onScrub })
    const cluster = container.querySelector('[data-checkpoint-cluster]') as Element
    fireEvent.click(cluster)
    expect(getByRole('dialog')).toBeTruthy()
    const track = container.querySelector('[role="slider"]') as Element
    fireEvent.pointerDown(track, { clientX: 900, pointerId: 2 })
    expect(queryByRole('dialog')).toBeNull()
    expect(onScrub).not.toHaveBeenCalled()
  })

  it('still swallows the rest of a dismiss gesture that drags before lifting, not just the initial press', () => {
    // Reviewer-verified bug: only the pointerDown that dismissed the popover was guarded — a
    // pointerMove on that same pointer (a touch drag that starts on the dismiss press) fell
    // through to the ordinary scrub path and moved the playhead as a side effect.
    const onScrub = vi.fn()
    const { container, getByRole, queryByRole } = renderTrack({ checkpoints: close, onScrub })
    const cluster = container.querySelector('[data-checkpoint-cluster]') as Element
    fireEvent.click(cluster)
    expect(getByRole('dialog')).toBeTruthy()
    const track = container.querySelector('[role="slider"]') as Element
    fireEvent.pointerDown(track, { clientX: 900, pointerId: 2 })
    expect(queryByRole('dialog')).toBeNull()
    fireEvent.pointerMove(track, { clientX: 850, pointerId: 2, buttons: 1 })
    expect(onScrub).not.toHaveBeenCalled()
    // The next, unrelated gesture (a different pointer id) scrubs normally — the suppression is
    // scoped to the one gesture that dismissed the popover, not stuck on afterward.
    fireEvent.pointerDown(track, { clientX: 500, pointerId: 3 })
    expect(onScrub).toHaveBeenCalled()
  })

  it('is keyboard-focusable on open', () => {
    const { container, getByRole } = renderTrack({ checkpoints: close })
    const cluster = container.querySelector('[data-checkpoint-cluster]') as Element
    fireEvent.click(cluster)
    expect(document.activeElement).toBe(getByRole('dialog'))
  })

  it('restores focus to the cluster button that opened it once it closes on Escape', () => {
    // The realistic trigger this guards against: a keyboard user reaches the cluster button via
    // Tab and activates it with Enter/Space, so the button already holds focus at the moment the
    // popover opens — `cluster.focus()` stands in for that, since a synthetic `click` alone
    // (unlike a real browser click) does not itself move focus in jsdom.
    const { container, getByRole, queryByRole } = renderTrack({ checkpoints: close })
    const cluster = container.querySelector('[data-checkpoint-cluster]') as HTMLElement
    cluster.focus()
    fireEvent.click(cluster)
    expect(getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(getByRole('dialog'), { key: 'Escape' })
    expect(queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(cluster)
  })

  it('restores focus to the cluster button once it closes on member selection', () => {
    const { container, getByRole, getByText, queryByRole } = renderTrack({ checkpoints: close })
    const cluster = container.querySelector('[data-checkpoint-cluster]') as HTMLElement
    cluster.focus()
    fireEvent.click(cluster)
    expect(getByRole('dialog')).toBeTruthy()
    fireEvent.click(getByText('Scene B'))
    expect(queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(cluster)
  })

  it('traps Tab within its own focusable elements while open, wrapping both directions', () => {
    const { container, getByRole } = renderTrack({ checkpoints: close })
    const cluster = container.querySelector('[data-checkpoint-cluster]') as HTMLElement
    fireEvent.click(cluster)
    const dialog = getByRole('dialog')
    const focusable = Array.from(dialog.querySelectorAll('button'))
    const closeButton = focusable[0]!
    const lastButton = focusable[focusable.length - 1]!
    expect(focusable.length).toBeGreaterThanOrEqual(2)

    lastButton.focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(document.activeElement).toBe(closeButton)

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(lastButton)
  })
})

describe('ScrubTrack touch magnifier (ADR-021)', () => {
  it('shows the magnifier bubble while a touch pointer is pressed on the track', () => {
    const { container, getByRole } = renderTrack()
    const track = getByRole('slider')
    fireEvent.pointerDown(track, { clientX: 400, clientY: 300, pointerId: 5, pointerType: 'touch' })
    expect(container.querySelector('[data-touch-magnifier]')).not.toBeNull()
  })

  it('does not show the magnifier for a mouse hover', () => {
    const { container, getByRole } = renderTrack()
    const track = getByRole('slider')
    fireEvent.pointerMove(track, { clientX: 400, clientY: 300, pointerId: 1, pointerType: 'mouse' })
    expect(container.querySelector('[data-touch-magnifier]')).toBeNull()
  })

  it('hides the magnifier once the touch pointer lifts', () => {
    const { container, getByRole } = renderTrack()
    const track = getByRole('slider')
    fireEvent.pointerDown(track, { clientX: 400, clientY: 300, pointerId: 5, pointerType: 'touch' })
    expect(container.querySelector('[data-touch-magnifier]')).not.toBeNull()
    fireEvent.pointerUp(track, { pointerId: 5, pointerType: 'touch' })
    expect(container.querySelector('[data-touch-magnifier]')).toBeNull()
  })

  it('shows the same precision-formatted time the hover readout would, in its own readout', () => {
    const checkpoint: TimelineCheckpoint = { id: 'cp1', t: 1e8, label: 'Touch Target' }
    const { container, getByRole } = renderTrack({ checkpoints: [checkpoint] })
    const track = getByRole('slider')
    const clientX = scale.toUnit(checkpoint.t) * 1000
    fireEvent.pointerDown(track, { clientX, clientY: 300, pointerId: 5, pointerType: 'touch' })
    const magnifier = container.querySelector('[data-touch-magnifier]')
    expect(magnifier?.textContent).toContain('Touch Target')
  })
})

describe('ScrubTrack touch/pen marker gesture arbitration (ADR-021 follow-up)', () => {
  it('selects a pip immediately on a mouse click, unaffected by touch/pen arbitration', () => {
    const checkpoint: TimelineCheckpoint = { id: 'cp1', t: 1e8, label: 'Mouse Pip' }
    const onScrub = vi.fn()
    const { container } = renderTrack({ checkpoints: [checkpoint], onScrub })
    const pip = container.querySelector('[data-checkpoint-pip]') as Element
    fireEvent.pointerDown(pip, { clientX: 500, clientY: 24, pointerId: 1, pointerType: 'mouse' })
    fireEvent.click(pip)
    expect(onScrub).toHaveBeenCalledWith(checkpoint.t)
  })

  it('selects a pip on a touch tap (lift within the slop) instead of scrubbing to the raw touch position', () => {
    const checkpoint: TimelineCheckpoint = { id: 'cp1', t: 1e8, label: 'Touch Pip' }
    const onScrub = vi.fn()
    const { container, getByRole } = renderTrack({ checkpoints: [checkpoint], onScrub })
    const pip = container.querySelector('[data-checkpoint-pip]') as Element
    const x = scale.toUnit(checkpoint.t) * 1000
    fireEvent.pointerDown(pip, { clientX: x, clientY: 24, pointerId: 7, pointerType: 'touch' })
    const track = getByRole('slider')
    fireEvent.pointerUp(track, { clientX: x, clientY: 24, pointerId: 7, pointerType: 'touch' })
    expect(onScrub).toHaveBeenCalledTimes(1)
    expect(onScrub).toHaveBeenCalledWith(checkpoint.t)
  })

  it('scrubs, and does not select, when a touch drag starting on a pip exceeds the tap slop', () => {
    const checkpoint: TimelineCheckpoint = { id: 'cp1', t: 1e8, label: 'Touch Pip' }
    const onScrub = vi.fn()
    const { container, getByRole } = renderTrack({ checkpoints: [checkpoint], onScrub })
    const pip = container.querySelector('[data-checkpoint-pip]') as Element
    const x = scale.toUnit(checkpoint.t) * 1000
    fireEvent.pointerDown(pip, { clientX: x, clientY: 24, pointerId: 7, pointerType: 'touch' })
    expect(onScrub).not.toHaveBeenCalled()
    const track = getByRole('slider')
    fireEvent.pointerMove(track, { clientX: x + 40, clientY: 24, pointerId: 7, pointerType: 'touch', buttons: 1 })
    fireEvent.pointerUp(track, { clientX: x + 40, clientY: 24, pointerId: 7, pointerType: 'touch' })
    expect(onScrub).toHaveBeenCalledTimes(1)
    // Scrubbed to (near) the dragged position, well clear of the snap radius back onto the pip's
    // own time — not the tap-select outcome, which would call onScrub with exactly checkpoint.t.
    expect(onScrub).not.toHaveBeenCalledWith(checkpoint.t)
  })

  it('opens the cluster popover on a touch tap, without scrubbing', () => {
    const close: TimelineCheckpoint[] = [
      { id: 'a', t: 1e8, label: 'Scene A' },
      { id: 'b', t: 1e8 + 10, label: 'Scene B' },
    ]
    const onOpenCluster = vi.fn()
    const onScrub = vi.fn()
    const { container, getByRole } = renderTrack({ checkpoints: close, onOpenCluster, onScrub })
    const cluster = container.querySelector('[data-checkpoint-cluster]') as Element
    fireEvent.pointerDown(cluster, { clientX: 500, clientY: 24, pointerId: 9, pointerType: 'touch' })
    const track = getByRole('slider')
    fireEvent.pointerUp(track, { clientX: 500, clientY: 24, pointerId: 9, pointerType: 'touch' })
    const popover = getByRole('dialog')
    expect(popover.textContent).toContain('Scene A')
    expect(popover.textContent).toContain('Scene B')
    expect(onOpenCluster).toHaveBeenCalledWith([close[1], close[0]])
    expect(onScrub).not.toHaveBeenCalled()
  })

  it('scrubs, and does not open the popover, when a touch drag starting on a cluster exceeds the tap slop', () => {
    const close: TimelineCheckpoint[] = [
      { id: 'a', t: 1e8, label: 'Scene A' },
      { id: 'b', t: 1e8 + 10, label: 'Scene B' },
    ]
    const onOpenCluster = vi.fn()
    const onScrub = vi.fn()
    const { container, getByRole, queryByRole } = renderTrack({ checkpoints: close, onOpenCluster, onScrub })
    const cluster = container.querySelector('[data-checkpoint-cluster]') as Element
    fireEvent.pointerDown(cluster, { clientX: 500, clientY: 24, pointerId: 9, pointerType: 'touch' })
    const track = getByRole('slider')
    fireEvent.pointerMove(track, { clientX: 540, clientY: 24, pointerId: 9, pointerType: 'touch', buttons: 1 })
    fireEvent.pointerUp(track, { clientX: 540, clientY: 24, pointerId: 9, pointerType: 'touch' })
    expect(onOpenCluster).not.toHaveBeenCalled()
    expect(queryByRole('dialog')).toBeNull()
    expect(onScrub).toHaveBeenCalled()
  })

  it('shows the magnifier immediately for a touch press pending on a marker, before slop is exceeded', () => {
    // The long-press allowance (`markerGesture.ts`'s own doc comment): the magnifier already
    // shows for any pressed touch/pen pointer regardless of arbitration state, so a motionless
    // press previews it without any separate long-press mechanism.
    const checkpoint: TimelineCheckpoint = { id: 'cp1', t: 1e8, label: 'Touch Pip' }
    const { container } = renderTrack({ checkpoints: [checkpoint] })
    const pip = container.querySelector('[data-checkpoint-pip]') as Element
    const x = scale.toUnit(checkpoint.t) * 1000
    fireEvent.pointerDown(pip, { clientX: x, clientY: 24, pointerId: 7, pointerType: 'touch' })
    expect(container.querySelector('[data-touch-magnifier]')).not.toBeNull()
  })

  it('does not leak a pending marker press into the next gesture on the same pointer id', () => {
    // A touch drag that starts on a pip and exceeds the slop clears `pendingMarkerPressRef`
    // (asserted by the "scrubs, and does not select" test above); this guards the other lift
    // path — a cancelled gesture must not leave a stale pending press for a later pointerdown
    // that happens to reuse the same pointer id to spuriously resolve as a tap.
    const checkpoint: TimelineCheckpoint = { id: 'cp1', t: 1e8, label: 'Touch Pip' }
    const onScrub = vi.fn()
    const { container, getByRole } = renderTrack({ checkpoints: [checkpoint], onScrub })
    const pip = container.querySelector('[data-checkpoint-pip]') as Element
    const x = scale.toUnit(checkpoint.t) * 1000
    fireEvent.pointerDown(pip, { clientX: x, clientY: 24, pointerId: 7, pointerType: 'touch' })
    const track = getByRole('slider')
    fireEvent.pointerCancel(track, { clientX: x, clientY: 24, pointerId: 7, pointerType: 'touch' })
    expect(onScrub).not.toHaveBeenCalled()
    fireEvent.pointerDown(track, { clientX: 900, clientY: 24, pointerId: 7, pointerType: 'touch' })
    expect(onScrub).toHaveBeenCalledTimes(1)
    expect(onScrub).not.toHaveBeenCalledWith(checkpoint.t)
  })
})
